import type {
  BalanceMetric,
  MetricCycle,
  ProviderHealth,
  QuotaMetric,
  UsageMetric,
  UsageSnapshot,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  factoryAuthSchema,
  factoryBillingLimitsSchema,
  factoryLegacyUsageSchema,
  factoryLimitPoolSchema,
  type FactoryAuth,
  type FactoryBillingWindow,
  type FactoryLegacyPool,
  type FactoryLegacyUsage,
  type FactoryLimitPool,
} from "./schema";

const API_ORIGIN = "https://api.factory.ai";
const BILLING_LIMITS_URL = `${API_ORIGIN}/api/billing/limits`;
const AUTH_URL = `${API_ORIGIN}/api/app/auth/me`;
const USAGE_PATH = "/api/organization/subscription/usage";

const HOUR_MS = 60 * 60 * 1_000;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;
const MILLISECOND_EPOCH = 1_000_000_000_000;
const SECOND_EPOCH = 1_000_000_000;

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "x-factory-client": "web-app",
  };
}

function usageUrl(userId: string | undefined): string {
  const url = new URL(USAGE_PATH, API_ORIGIN);
  url.searchParams.set("useCache", "true");
  if (userId !== undefined) {
    url.searchParams.set("userId", userId);
  }
  return url.toString();
}

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401 || response.status === 403) {
    return { kind: "credential_invalid" };
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

type ReadResult =
  | { kind: "ok"; body: unknown }
  | { kind: "http"; response: Response }
  | { kind: "network" };

async function readJson(
  fetch: typeof globalThis.fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<ReadResult> {
  try {
    const response = await fetch(url, { method: "GET", headers, signal });
    if (!response.ok) {
      return { kind: "http", response };
    }
    try {
      return { kind: "ok", body: await response.json() };
    } catch {
      return { kind: "ok", body: undefined };
    }
  } catch {
    return { kind: "network" };
  }
}

function epochMillis(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  if (value >= MILLISECOND_EPOCH) return value;
  if (value >= SECOND_EPOCH) return value * 1_000;
  return undefined;
}

function parseWindowEnd(
  value: FactoryBillingWindow["windowEnd"],
): number | undefined {
  if (typeof value === "number") return epochMillis(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return epochMillis(Number(trimmed));
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resetsAtForWindow(
  window: FactoryBillingWindow,
  now: number,
): number | undefined {
  const seconds = window.secondsRemaining;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return now + Math.round(seconds * 1_000);
  }
  const end = parseWindowEnd(window.windowEnd);
  return end !== undefined && end > now ? end : undefined;
}

function windowHasClock(window: FactoryBillingWindow): boolean {
  if (window.secondsRemaining !== null && window.secondsRemaining !== undefined) {
    return true;
  }
  if (window.windowEnd === null || window.windowEnd === undefined) return false;
  return typeof window.windowEnd === "number" || window.windowEnd.trim() !== "";
}

function poolIsActive(pool: FactoryLimitPool): boolean {
  return [pool.fiveHour, pool.weekly, pool.monthly].some(
    (window) => window.usedPercent > 0 || windowHasClock(window),
  );
}

function quotaWindow(
  identity: Pick<QuotaMetric, "id" | "label" | "scope">,
  window: FactoryBillingWindow,
  now: number,
  durationMs: number | undefined,
): QuotaMetric {
  const resetsAt = resetsAtForWindow(window, now);
  return {
    ...identity,
    type: "quota",
    usedRatio: Math.min(1, Math.max(0, window.usedPercent / 100)),
    cycle: {
      cadence: "rolling",
      ...(resetsAt === undefined ? {} : { resetsAt }),
      ...(durationMs === undefined || resetsAt === undefined
        ? {}
        : { durationMs }),
    },
  };
}

function standardWindows(pool: FactoryLimitPool, now: number): QuotaMetric[] {
  return [
    quotaWindow(
      { id: "standard-five-hour", label: "5-hour", scope: "general" },
      pool.fiveHour,
      now,
      FIVE_HOURS_MS,
    ),
    quotaWindow(
      { id: "standard-weekly", label: "Weekly", scope: "general" },
      pool.weekly,
      now,
      WEEK_MS,
    ),
    quotaWindow(
      { id: "standard-monthly", label: "Monthly", scope: "general" },
      pool.monthly,
      now,
      undefined,
    ),
  ];
}

function coreWindows(pool: FactoryLimitPool, now: number): QuotaMetric[] {
  return [
    quotaWindow(
      { id: "core-five-hour", label: "Core 5-hour", scope: "product" },
      pool.fiveHour,
      now,
      FIVE_HOURS_MS,
    ),
    quotaWindow(
      { id: "core-weekly", label: "Core weekly", scope: "product" },
      pool.weekly,
      now,
      WEEK_MS,
    ),
    quotaWindow(
      { id: "core-monthly", label: "Core monthly", scope: "product" },
      pool.monthly,
      now,
      undefined,
    ),
  ];
}

function extraUsageBalance(
  cents: number | null | undefined,
  allowed: boolean | null | undefined,
): BalanceMetric | undefined {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) {
    return undefined;
  }
  if (allowed !== true && cents === 0) return undefined;
  return {
    type: "balance",
    id: "extra-usage",
    label: "Extra usage",
    scope: "product",
    // Factory's published extra-usage balance is prepaid USD. The payload
    // names cents and does not name a currency.
    value: cents / 100,
    unit: "USD",
  };
}

function snapshotFromBilling(
  body: unknown,
  now: number,
): UsageSnapshot | undefined {
  const parsed = factoryBillingLimitsSchema.safeParse(body);
  if (!parsed.success || parsed.data.usesTokenRateLimitsBilling !== true) {
    return undefined;
  }
  const limits = parsed.data.limits;
  if (!limits) return undefined;

  const metrics: UsageMetric[] = standardWindows(limits.standard, now);
  const core = factoryLimitPoolSchema.safeParse(limits.core);
  const coreMetrics =
    core.success && poolIsActive(core.data) ? coreWindows(core.data, now) : [];
  metrics.push(...coreMetrics);

  const balance = extraUsageBalance(
    parsed.data.extraUsageBalanceCents,
    parsed.data.extraUsageAllowed,
  );
  if (balance) metrics.push(balance);

  return {
    providerKind: "factory",
    source: "api-key",
    fetchedAt: now,
    metrics,
    usageGroups: usageGroups(metrics),
  };
}

function present(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function poolHasSignal(pool: FactoryLegacyPool | null | undefined): boolean {
  if (!pool) return false;
  return (
    present(pool.userTokens) ||
    present(pool.totalAllowance) ||
    present(pool.usedRatio) ||
    present(pool.used) ||
    present(pool.allowance)
  );
}

function usedRatioFromPool(pool: FactoryLegacyPool): number | undefined {
  const ratio = pool.usedRatio;
  const ratioIsUnit =
    typeof ratio === "number" &&
    Number.isFinite(ratio) &&
    ratio >= -0.001 &&
    ratio <= 1.001;
  const usedTokens = pool.userTokens;
  const allowanceTokens = pool.totalAllowance;
  const countsUsable =
    typeof usedTokens === "number" &&
    Number.isFinite(usedTokens) &&
    usedTokens >= 0 &&
    typeof allowanceTokens === "number" &&
    Number.isFinite(allowanceTokens) &&
    allowanceTokens > 0;

  // A zero ratio next to real token counts is treated as a stale cached ratio.
  if (ratioIsUnit && ratio <= 0 && countsUsable && usedTokens > 0) {
    return Math.min(1, usedTokens / allowanceTokens);
  }
  if (ratioIsUnit) return Math.min(1, Math.max(0, ratio));
  if (
    typeof ratio === "number" &&
    Number.isFinite(ratio) &&
    ratio > 1.001 &&
    ratio <= 100.001
  ) {
    return Math.min(1, ratio / 100);
  }
  if (countsUsable) return Math.min(1, usedTokens / allowanceTokens);

  const used = pool.used;
  const allowance = pool.allowance;
  if (
    typeof used === "number" &&
    Number.isFinite(used) &&
    used >= 0 &&
    typeof allowance === "number" &&
    Number.isFinite(allowance) &&
    allowance > 0
  ) {
    return Math.min(1, used / allowance);
  }
  return undefined;
}

function legacyCycle(
  start: number | null | undefined,
  end: number | null | undefined,
): MetricCycle {
  const startedAt = epochMillis(start);
  const resetsAt = epochMillis(end);
  if (
    startedAt !== undefined &&
    resetsAt !== undefined &&
    resetsAt > startedAt
  ) {
    return {
      cadence: "rolling",
      startedAt,
      resetsAt,
      durationMs: resetsAt - startedAt,
    };
  }
  if (resetsAt !== undefined) return { cadence: "rolling", resetsAt };
  return { cadence: "rolling" };
}

function legacyQuota(
  identity: Pick<QuotaMetric, "id" | "label" | "scope">,
  pool: FactoryLegacyPool,
  cycle: MetricCycle,
): QuotaMetric | undefined {
  const usedRatio = usedRatioFromPool(pool);
  if (usedRatio === undefined) return undefined;
  const limit =
    typeof pool.totalAllowance === "number" && pool.totalAllowance > 0
      ? pool.totalAllowance
      : typeof pool.allowance === "number" && pool.allowance > 0
        ? pool.allowance
        : undefined;
  const used =
    limit === undefined
      ? undefined
      : typeof pool.userTokens === "number"
        ? pool.userTokens
        : typeof pool.used === "number"
          ? pool.used
          : undefined;
  const countsMatch =
    used !== undefined &&
    limit !== undefined &&
    Math.abs(used / limit - usedRatio) <= 0.001;
  return {
    ...identity,
    type: "quota",
    usedRatio,
    ...(countsMatch ? { used, limit } : {}),
    cycle,
  };
}

function legacyBody(parsed: FactoryLegacyUsage) {
  const nested = parsed.usage;
  if (
    nested &&
    (poolHasSignal(nested.standard) || poolHasSignal(nested.premium))
  ) {
    return nested;
  }
  return parsed;
}

function snapshotFromLegacy(
  body: unknown,
  now: number,
): UsageSnapshot | undefined {
  const parsed = factoryLegacyUsageSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const source = legacyBody(parsed.data);
  const cycle = legacyCycle(source.startDate, source.endDate);
  const standard = source.standard
    ? legacyQuota(
        { id: "standard-monthly", label: "Monthly", scope: "general" },
        source.standard,
        cycle,
      )
    : undefined;
  const premium = source.premium
    ? legacyQuota(
        { id: "premium-monthly", label: "Premium", scope: "product" },
        source.premium,
        cycle,
      )
    : undefined;
  const metrics = [standard, premium].filter(
    (metric): metric is QuotaMetric => metric !== undefined,
  );
  if (metrics.length === 0) return undefined;
  return {
    providerKind: "factory",
    source: "api-key",
    fetchedAt: now,
    metrics,
    usageGroups: usageGroups(metrics),
  };
}

function usageGroups(metrics: UsageMetric[]): UsageSnapshot["usageGroups"] {
  const standardIds = metrics
    .filter((metric) => metric.id.startsWith("standard-") || metric.id === "premium-monthly")
    .map((metric) => metric.id);
  const coreIds = metrics
    .filter((metric) => metric.id.startsWith("core-"))
    .map((metric) => metric.id);
  const creditIds = metrics
    .filter((metric) => metric.id === "extra-usage")
    .map((metric) => metric.id);
  return [
    ...(standardIds.length
      ? [{ id: "usage", label: "Usage", metricIds: standardIds }]
      : []),
    ...(coreIds.length
      ? [{ id: "droid-core", label: "Droid Core", metricIds: coreIds }]
      : []),
    ...(creditIds.length
      ? [{ id: "credits", label: "Credits", metricIds: creditIds }]
      : []),
  ];
}

function parsedAuth(body: unknown): FactoryAuth | undefined {
  const parsed = factoryAuthSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

function planLabelFromAuth(auth: FactoryAuth | undefined): string | undefined {
  const subscription = auth?.organization?.subscription;
  const planName = subscription?.orbSubscription?.plan?.name?.trim();
  if (planName && planName.toLowerCase() !== "factory") return planName;
  const tier = subscription?.factoryTier?.trim();
  if (tier && tier.toLowerCase() !== "droid") return tier;
  return undefined;
}

function userIdFromAuth(auth: FactoryAuth | undefined): string | undefined {
  const profileId = auth?.userProfile?.id?.trim();
  if (profileId) return profileId;
  const userId = auth?.user?.id?.trim();
  return userId || undefined;
}

function withPlan(
  snapshot: UsageSnapshot,
  planLabel: string | undefined,
): UsageSnapshot {
  return planLabel === undefined ? snapshot : { ...snapshot, planLabel };
}

async function collectFactory({
  credential,
  fetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  const apiKey =
    credential?.kind === "api-key" ? credential.value.trim() : "";
  if (!apiKey) {
    return { ok: false, health: { kind: "signed_out" } };
  }

  const headers = requestHeaders(apiKey);

  try {
    const billing = await readJson(fetch, BILLING_LIMITS_URL, headers, signal);
    const billingSnapshot =
      billing.kind === "ok" ? snapshotFromBilling(billing.body, now) : undefined;
    if (billingSnapshot) {
      const auth = await readJson(fetch, AUTH_URL, headers, signal);
      const planLabel =
        auth.kind === "ok" ? planLabelFromAuth(parsedAuth(auth.body)) : undefined;
      return { ok: true, snapshot: withPlan(billingSnapshot, planLabel) };
    }

    const auth = await readJson(fetch, AUTH_URL, headers, signal);
    if (auth.kind === "http") {
      const health = healthForResponse(auth.response, now);
      if (health.kind === "credential_invalid") {
        return { ok: false, health };
      }
    }
    const authBody = auth.kind === "ok" ? parsedAuth(auth.body) : undefined;
    const usage = await readJson(
      fetch,
      usageUrl(userIdFromAuth(authBody)),
      headers,
      signal,
    );
    if (usage.kind === "network") {
      return { ok: false, health: { kind: "temporary_error" } };
    }
    if (usage.kind === "http") {
      return { ok: false, health: healthForResponse(usage.response, now) };
    }
    const legacy = snapshotFromLegacy(usage.body, now);
    if (!legacy) {
      return { ok: false, health: { kind: "provider_changed" } };
    }
    return {
      ok: true,
      snapshot: withPlan(legacy, planLabelFromAuth(authBody)),
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const factoryAdapter: ProviderCollector<"factory"> = {
  id: "factory",
  collect: collectFactory,
};
