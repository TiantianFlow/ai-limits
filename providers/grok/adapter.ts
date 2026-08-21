import type {
  BalanceMetric,
  ProviderHealth,
  QuotaMetric,
  UsageGroup,
  UsageMetric,
} from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { retryAtFromResponse } from "../retry-after";
import {
  grokRateLimitsSchema,
  grokSessionSchema,
  grokSubscriptionItemSchema,
  grokSubscriptionsSchema,
  grokTokenFieldsSchema,
  type GrokRateLimits,
} from "./schema";
import { decodeGrokCreditsConfigResponse } from "./credits-config";
import {
  EMPTY_GRPC_WEB_UNARY,
  GRPC_WEB_CONTENT_TYPE,
  firstDataPayload,
  grpcStatusFrom,
  parseGrpcWebFrames,
} from "./grpc-web";
import { inspectDecodedCreditsConfig } from "./usage-pool";

const SESSION_ENDPOINT = "https://grok.com/api/auth/session";
const RATE_LIMITS_ENDPOINT = "https://grok.com/rest/rate-limits";
const SUBSCRIPTIONS_ENDPOINT = "https://grok.com/rest/subscriptions";
const POOL_CONNECT_ENDPOINT =
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
// grok.com chat mode aliases the first-party client sends as modelName.
// Expected to rot when they rename or retire a mode.
export const GROK_RATE_LIMIT_MODEL_NAMES = [
  "fast",
  "expert",
  "heavy",
  "auto",
] as const;
export type GrokRateLimitModelName =
  (typeof GROK_RATE_LIMIT_MODEL_NAMES)[number];
const REQUIRED_RATE_LIMIT_FIELDS = [
  "windowSizeSeconds",
  "remainingQueries",
  "totalQueries",
] as const;
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WEEK_SECONDS = 7 * DAY_SECONDS;
const ACTIVE_SUBSCRIPTION = "SUBSCRIPTION_STATUS_ACTIVE";

// Highest SuperGrok-family tier wins. Order is the live product ladder
// (Heavy > Plus > SuperGrok > Lite), inferred from grok.com's own tier
// enum and paywall copy — not a signed-in payload.
const SUPERGROK_PLAN_TIERS = [
  {
    tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
    label: "SuperGrok Heavy",
  },
  {
    tier: "SUBSCRIPTION_TIER_SUPER_GROK_PLUS",
    label: "SuperGrok Plus",
  },
  {
    tier: "SUBSCRIPTION_TIER_GROK_PRO",
    label: "SuperGrok",
  },
  {
    tier: "SUBSCRIPTION_TIER_SUPER_GROK_LITE",
    label: "SuperGrok Lite",
  },
] as const;

const EXCLUDED_PLAN_TIERS = new Set<string>([
  "SUBSCRIPTION_TIER_INVALID",
  "SUBSCRIPTION_TIER_X_BASIC",
  "SUBSCRIPTION_TIER_X_PREMIUM",
  "SUBSCRIPTION_TIER_X_PREMIUM_PLUS",
]);

const SUPERGROK_PLAN_BY_TIER = new Map<string, string>(
  SUPERGROK_PLAN_TIERS.map((entry) => [entry.tier, entry.label]),
);

function isNonEmptyIdentifier(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function nestedUserId(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as { userId?: unknown }).userId;
}

function sessionHasSignedInIdentity(session: {
  status?: string;
  session?: unknown;
  userId?: unknown;
  user?: unknown;
}): boolean {
  if (session.status !== "authenticated") {
    return false;
  }
  // Observed envelope: { status, session: { userId, ... } }.
  // Flat .userId / .user.userId are tolerated fallbacks only.
  return (
    isNonEmptyIdentifier(nestedUserId(session.session)) ||
    isNonEmptyIdentifier(session.userId) ||
    isNonEmptyIdentifier(nestedUserId(session.user))
  );
}

function compactErrorToken(value: unknown, maxLength = 80): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

function rateLimitsHttpFailureMessage(status: number, body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return `Grok rate-limits HTTP ${status}.`;
  }
  const record = body as { code?: unknown; message?: unknown };
  const code = compactErrorToken(record.code);
  const message = compactErrorToken(record.message);
  return `Grok rate-limits HTTP ${status}.${code === undefined ? "" : ` code=${code}`}${message === undefined ? "" : ` message=${message}`}`;
}

function rateLimitsSchemaFailureMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "Grok rate-limits response is not an object.";
  }
  const record = value as Record<string, unknown>;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const field of REQUIRED_RATE_LIMIT_FIELDS) {
    if (!(field in record) || record[field] === undefined) {
      missing.push(field);
      continue;
    }
    if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
      invalid.push(field);
    }
  }
  if (missing.length > 0) {
    return `Grok rate-limits response missing required field: ${missing.join(",")}`;
  }
  if (invalid.length > 0) {
    return `Grok rate-limits response has non-finite field: ${invalid.join(",")}`;
  }
  return "Grok rate-limits response failed validation.";
}

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401) {
    return { kind: "signed_out" };
  }

  if (response.status === 429 || response.status >= 500) {
    const retryAt = retryAtFromResponse(response, now);
    return {
      kind: "temporary_error",
      ...(retryAt === undefined ? {} : { retryAt }),
    };
  }

  return { kind: "provider_changed" };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function windowIdentity(
  durationSeconds: number,
  kind: "queries" | "tokens",
  mode: string,
): Pick<QuotaMetric, "id" | "label"> {
  if (durationSeconds === WEEK_SECONDS) {
    return {
      id: `weekly-${mode}-${kind}`,
      label: `Weekly ${mode} ${kind}`,
    };
  }

  if (durationSeconds % DAY_SECONDS === 0) {
    const days = durationSeconds / DAY_SECONDS;
    return {
      id: `${days}-day-${mode}-${kind}`,
      label: `${days}-day ${mode} ${kind}`,
    };
  }

  const hours = durationSeconds / HOUR_SECONDS;
  return {
    id: `${hours}-hour-${mode}-${kind}`,
    label: `${hours}-hour ${mode} ${kind}`,
  };
}

function finiteWaitSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeQuota(
  remaining: number,
  total: number,
  windowSizeSeconds: number,
  waitTimeSeconds: unknown,
  kind: "queries" | "tokens",
  mode: string,
  now: number,
): QuotaMetric | undefined {
  if (
    !Number.isFinite(remaining) ||
    remaining < 0 ||
    !Number.isFinite(total) ||
    total <= 0 ||
    remaining > total
  ) {
    return undefined;
  }

  const waitSeconds = finiteWaitSeconds(waitTimeSeconds);
  return {
    type: "quota",
    ...windowIdentity(windowSizeSeconds, kind, mode),
    scope: "general",
    usedRatio: (total - remaining) / total,
    used: total - remaining,
    limit: total,
    unit: kind,
    cycle: {
      cadence: "rolling",
      durationMs: windowSizeSeconds * 1_000,
      ...(waitSeconds === undefined
        ? {}
        : { resetsAt: now + waitSeconds * 1_000 }),
    },
  };
}

function normalizeQueries(
  usage: GrokRateLimits,
  mode: string,
  now: number,
): QuotaMetric | undefined {
  return normalizeQuota(
    usage.remainingQueries,
    usage.totalQueries,
    usage.windowSizeSeconds,
    usage.waitTimeSeconds,
    "queries",
    mode,
    now,
  );
}

function normalizeTokens(
  usage: GrokRateLimits,
  mode: string,
  now: number,
): QuotaMetric | undefined {
  const tokens = grokTokenFieldsSchema.safeParse(usage);
  if (!tokens.success) {
    return undefined;
  }

  return normalizeQuota(
    tokens.data.remainingTokens,
    tokens.data.totalTokens,
    usage.windowSizeSeconds,
    usage.waitTimeSeconds,
    "tokens",
    mode,
    now,
  );
}

type PoolExplainReason =
  | "disabled"
  | "flag_missing"
  | "empty"
  | "not_found"
  | "unavailable"
  | "unparseable"
  | "never_completed";

type PoolProbeResult =
  | {
      kind: "metric";
      metric: QuotaMetric;
      extraCredits?: BalanceMetric;
    }
  | {
      kind: "explained";
      reason: PoolExplainReason;
      message: string;
      extraCredits?: BalanceMetric;
    }
  | { kind: "signed_out" };

function poolRouteDetail(route: string, response: Response): string {
  const contentType = response.headers.get("content-type") ?? "none";
  return `${route} HTTP ${response.status} content-type=${contentType}`;
}

function explained(
  reason: PoolExplainReason,
  message: string,
): Extract<PoolProbeResult, { kind: "explained" }> {
  return { kind: "explained", reason, message };
}

function isGrpcWebContentType(value: string): boolean {
  return /application\/grpc-web(\+proto)?/i.test(value);
}

async function probeUsagePool(
  injectedFetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<PoolProbeResult> {
  let connectDetail: string | undefined;
  try {
    const connectResponse = await injectedFetch(POOL_CONNECT_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: GRPC_WEB_CONTENT_TYPE,
        "Content-Type": GRPC_WEB_CONTENT_TYPE,
        "X-Grpc-Web": "1",
      },
      body: EMPTY_GRPC_WEB_UNARY,
      signal,
    });
    connectDetail = poolRouteDetail("GetGrokCreditsConfig", connectResponse);
    if (connectResponse.status === 401) {
      return { kind: "signed_out" };
    }
    if (connectResponse.status === 404) {
      return explained(
        "not_found",
        `Grok usage-pool route not found. ${connectDetail}`,
      );
    }
    if (!connectResponse.ok) {
      return explained(
        "unavailable",
        `Grok usage-pool route unavailable. ${connectDetail}`,
      );
    }
    const contentType = connectResponse.headers.get("content-type") ?? "none";
    if (!isGrpcWebContentType(contentType)) {
      return explained(
        "unavailable",
        `Grok usage-pool route unavailable. ${connectDetail}`,
      );
    }
    const bytes = new Uint8Array(await connectResponse.arrayBuffer());
    const parsed = parseGrpcWebFrames(bytes);
    if (!parsed.ok) {
      return explained("unparseable", `${parsed.message} ${connectDetail}`);
    }
    const grpc = grpcStatusFrom(connectResponse.headers, parsed.frames);
    if (grpc !== undefined && grpc.status !== 0) {
      const detail =
        grpc.message === undefined || grpc.message.trim() === ""
          ? ""
          : ` message=${grpc.message}`;
      return explained(
        "unavailable",
        `Grok usage-pool grpc-status=${grpc.status}.${detail} ${connectDetail}`,
      );
    }
    const payload = firstDataPayload(parsed.frames);
    if (payload === undefined) {
      return explained(
        "unparseable",
        `Grok usage-pool gRPC-Web response has no data frame. ${connectDetail}`,
      );
    }
    const decoded = decodeGrokCreditsConfigResponse(payload);
    if (!decoded.ok) {
      return explained("unparseable", `${decoded.message} ${connectDetail}`);
    }
    const extraCredits = extraCreditsFrom(decoded.config);
    const inspected = inspectDecodedCreditsConfig(decoded.config);
    if (inspected.kind === "metric") {
      return {
        kind: "metric",
        metric: inspected.metric,
        ...(extraCredits === undefined ? {} : { extraCredits }),
      };
    }
    const note =
      inspected.kind === "unparseable"
        ? explained("unparseable", `${inspected.message} ${connectDetail}`)
        : inspected.reason === "disabled"
          ? explained(
              "disabled",
              `Grok usage-pool disabled: is_unified_billing_user is false. ${connectDetail}`,
            )
          : inspected.reason === "flag_missing"
            ? explained(
                "flag_missing",
                `Grok usage-pool is missing is_unified_billing_user. ${connectDetail}`,
              )
            : explained(
                "empty",
                `Grok usage-pool config is empty. ${connectDetail}`,
              );
    return extraCredits === undefined
      ? note
      : { ...note, extraCredits };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    const unfinished =
      connectDetail ?? "GetGrokCreditsConfig never completed.";
    return explained(
      "never_completed",
      `Grok usage-pool never completed. request failed. ${unfinished}`,
    );
  }
}

function planLabelFromSubscriptions(value: unknown): string | undefined {
  const parsed = grokSubscriptionsSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  let sawUnmappedActive = false;
  const activeFamilyTiers = new Set<string>();
  for (const candidate of parsed.data.subscriptions ?? []) {
    const item = grokSubscriptionItemSchema.safeParse(candidate);
    if (!item.success || item.data.status !== ACTIVE_SUBSCRIPTION) {
      continue;
    }

    const tier = item.data.tier;
    if (tier !== undefined && SUPERGROK_PLAN_BY_TIER.has(tier)) {
      activeFamilyTiers.add(tier);
      continue;
    }

    if (tier !== undefined && EXCLUDED_PLAN_TIERS.has(tier)) {
      continue;
    }

    sawUnmappedActive = true;
  }

  const highest = SUPERGROK_PLAN_TIERS.find((entry) =>
    activeFamilyTiers.has(entry.tier),
  );
  if (highest) {
    return highest.label;
  }

  return sawUnmappedActive ? undefined : "Free";
}

async function collectGrok({
  fetch: injectedFetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const sessionResponse = await injectedFetch(SESSION_ENDPOINT, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!sessionResponse.ok) {
      return { ok: false, health: healthForResponse(sessionResponse, now) };
    }

    const session = grokSessionSchema.safeParse(
      await parseJson(sessionResponse),
    );
    if (!session.success || !sessionHasSignedInIdentity(session.data)) {
      return { ok: false, health: { kind: "signed_out" } };
    }

    const pool = await probeUsagePool(injectedFetch, signal);
    if (pool.kind === "signed_out") {
      return { ok: false, health: { kind: "signed_out" } };
    }

    let modeMetrics: QuotaMetric[] = [];
    const poolMetric = pool.kind === "metric" ? pool.metric : undefined;
    const poolReason = pool.kind === "explained" ? pool.reason : undefined;
    const poolNote = pool.kind === "explained" ? pool.message : undefined;
    if (poolNote !== undefined) {
      console.debug("[grok] usage-pool:", poolReason, poolNote);
    }
    const extraCredits = pool.extraCredits;

    if (poolMetric === undefined) {
      const windows = await collectModeWindows(injectedFetch, now, signal);
      if (windows.kind === "signed_out") {
        return { ok: false, health: { kind: "signed_out" } };
      }
      modeMetrics = windows.metrics;
      if (
        modeMetrics.length === 0 &&
        (extraCredits === undefined || extraCredits.value === 0)
      ) {
        if (pool.kind === "explained" && pool.reason === "unparseable") {
          return {
            ok: false,
            health: { kind: "provider_changed", message: pool.message },
          };
        }
        if (windows.transient !== undefined) {
          return { ok: false, health: windows.transient };
        }
        return {
          ok: false,
          health: {
            kind: "provider_changed",
            message:
              windows.failures[0] ??
              poolNote ??
              "Grok rate-limits response failed validation.",
          },
        };
      }
    }

    const metrics: UsageMetric[] = [
      ...(poolMetric === undefined ? [] : [poolMetric]),
      ...modeMetrics,
      ...(extraCredits === undefined ? [] : [extraCredits]),
    ];

    let planLabel: string | undefined;
    try {
      const subscriptionsResponse = await injectedFetch(
        SUBSCRIPTIONS_ENDPOINT,
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal,
        },
      );
      if (subscriptionsResponse.ok) {
        planLabel = planLabelFromSubscriptions(
          await parseJson(subscriptionsResponse),
        );
      }
    } catch {
      planLabel = undefined;
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "grok",
        ...(planLabel === undefined ? {} : { planLabel }),
        source: "web-session",
        fetchedAt: now,
        metrics,
        usageGroups: grokUsageGroups(
          poolMetric,
          modeMetrics,
          extraCredits,
          poolReason,
        ),
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

async function collectModeWindows(
  injectedFetch: typeof globalThis.fetch,
  now: number,
  signal: AbortSignal,
): Promise<
  | { kind: "signed_out" }
  | {
      kind: "ok";
      metrics: QuotaMetric[];
      failures: string[];
      transient: ProviderHealth | undefined;
    }
> {
  const metrics: QuotaMetric[] = [];
  const failures: string[] = [];
  let transient: ProviderHealth | undefined;

  for (const mode of GROK_RATE_LIMIT_MODEL_NAMES) {
    const usageResponse = await injectedFetch(RATE_LIMITS_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ modelName: mode }),
      signal,
    });
    if (usageResponse.status === 401) {
      return { kind: "signed_out" };
    }
    if (!usageResponse.ok) {
      const errorBody = await parseJson(usageResponse);
      const health = healthForResponse(usageResponse, now);
      const detail = `${mode}: ${rateLimitsHttpFailureMessage(usageResponse.status, errorBody)}`;
      failures.push(detail);
      if (health.kind === "temporary_error" && transient === undefined) {
        transient = { ...health, message: detail };
      }
      continue;
    }

    const usageBody = await parseJson(usageResponse);
    const usage = grokRateLimitsSchema.safeParse(usageBody);
    if (!usage.success) {
      failures.push(`${mode}: ${rateLimitsSchemaFailureMessage(usageBody)}`);
      continue;
    }

    const queries = normalizeQueries(usage.data, mode, now);
    if (!queries) {
      failures.push(
        `${mode}: Grok rate-limits response has contradictory query counts.`,
      );
      continue;
    }

    metrics.push(queries);
    const tokens = normalizeTokens(usage.data, mode, now);
    if (tokens !== undefined) {
      metrics.push(tokens);
    }
  }

  return { kind: "ok", metrics, failures, transient };
}

function extraCreditsFrom(config: {
  prepaidBalanceCents?: number;
}): BalanceMetric | undefined {
  if (config.prepaidBalanceCents === undefined) {
    return undefined;
  }
  return {
    type: "balance",
    id: "extra-usage-credits",
    label: "Extra usage credits",
    scope: "product",
    unit: "USD",
    value: config.prepaidBalanceCents / 100,
  };
}

function grokUsageGroups(
  poolMetric: QuotaMetric | undefined,
  modeMetrics: readonly QuotaMetric[],
  extraCredits: BalanceMetric | undefined,
  poolReason: PoolExplainReason | undefined,
): UsageGroup[] {
  const groups: UsageGroup[] = [];
  const extraId = extraCredits === undefined ? [] : [extraCredits.id];
  const unavailable =
    poolReason === undefined ? {} : { description: poolReason };
  if (poolMetric !== undefined) {
    groups.push({
      id: "usage-pool",
      label: "Usage pool",
      metricIds: [poolMetric.id, ...extraId],
    });
  }
  if (modeMetrics.length > 0) {
    groups.push({
      id: "rate-limits",
      label: "Chat rate limits",
      ...(poolMetric !== undefined ? {} : unavailable),
      metricIds: [
        ...modeMetrics.map((metric) => metric.id),
        ...(poolMetric === undefined ? extraId : []),
      ],
    });
  } else if (poolMetric === undefined && extraCredits !== undefined) {
    groups.push({
      id: "usage-pool",
      label: "Usage pool",
      ...unavailable,
      metricIds: extraId,
    });
  }
  return groups;
}

export const grokAdapter: ProviderCollector<"grok"> = {
  id: "grok",
  collect: collectGrok,
};
