import type {
  MetricCycle,
  ProviderHealth,
  QuotaMetric,
  UsageSnapshot,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  zaiQuotaEnvelopeSchema,
  zaiQuotaLimitSchema,
  type ZaiQuotaLimit,
} from "./schema";

const API_ORIGIN = "https://api.z.ai";
const QUOTA_LIMIT_URL = `${API_ORIGIN}/api/monitor/usage/quota/limit`;

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// Reset times are allowed one minute of clock skew past a full window.
const RESET_SKEW_MS = MINUTE_MS;

// Z.ai's limit-entry `unit` codes. 5 is minutes, but `unit: 5, number: 1`
// on a TIME_LIMIT entry marks the monthly MCP allowance rather than a window.
const UNIT_MS: Record<number, number> = {
  1: DAY_MS,
  3: HOUR_MS,
  5: MINUTE_MS,
  6: WEEK_MS,
};

// Z.ai reports some failures as HTTP 200 with an error code in the body.
// 1000–1004 are its authentication failures; 1302/1303 are rate limits.
const BODY_AUTH_CODES = new Set([401, 1000, 1001, 1002, 1003, 1004]);
const BODY_RATE_LIMIT_CODES = new Set([429, 1302, 1303]);

type PlanWindow = {
  id: "five-hour" | "weekly";
  label: string;
  durationMs: number;
};

const FIVE_HOUR_WINDOW: PlanWindow = {
  id: "five-hour",
  label: "5-hour",
  durationMs: FIVE_HOURS_MS,
};
const WEEKLY_WINDOW: PlanWindow = {
  id: "weekly",
  label: "Weekly",
  durationMs: WEEK_MS,
};

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
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

function bodyCode(code: number | string | undefined): number | undefined {
  if (typeof code === "number") return code;
  if (typeof code === "string" && /^\d+$/.test(code.trim())) {
    return Number(code.trim());
  }
  return undefined;
}

function healthForBodyError(code: number | undefined): ProviderHealth {
  if (code !== undefined && BODY_AUTH_CODES.has(code)) {
    return { kind: "credential_invalid" };
  }
  if (code !== undefined && BODY_RATE_LIMIT_CODES.has(code)) {
    return { kind: "temporary_error" };
  }
  return { kind: "provider_changed" };
}

function windowDurationMs(limit: ZaiQuotaLimit): number | undefined {
  const unitMs = UNIT_MS[limit.unit];
  if (unitMs === undefined || limit.number <= 0) return undefined;
  return unitMs * limit.number;
}

function planWindow(limit: ZaiQuotaLimit): PlanWindow | undefined {
  if (limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT") {
    return undefined;
  }
  const durationMs = windowDurationMs(limit);
  if (durationMs === FIVE_HOURS_MS) return FIVE_HOUR_WINDOW;
  if (durationMs === WEEK_MS) return WEEKLY_WINDOW;
  return undefined;
}

function nonNegative(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function usageCounts(
  limit: ZaiQuotaLimit,
): { used: number; limit: number } | undefined {
  const allowance = nonNegative(limit.usage);
  if (allowance === undefined || allowance <= 0) return undefined;
  const current = nonNegative(limit.currentValue);
  const remaining = nonNegative(limit.remaining);
  const used =
    current ?? (remaining === undefined ? undefined : allowance - remaining);
  if (used === undefined) return undefined;
  return { used: Math.min(allowance, Math.max(0, used)), limit: allowance };
}

function resetsAtWithin(
  limit: ZaiQuotaLimit,
  now: number,
  maxDurationMs: number | undefined,
): number | undefined {
  const reset = nonNegative(limit.nextResetTime);
  if (reset === undefined || reset <= now) return undefined;
  // Some accounts report five-hour resets hours too late (a timezone slip).
  // A reset beyond the window cannot be right, so omit it instead of guessing.
  if (maxDurationMs !== undefined && reset > now + maxDurationMs + RESET_SKEW_MS) {
    return undefined;
  }
  return reset;
}

function quotaMetric(
  identity: Pick<QuotaMetric, "id" | "label" | "scope">,
  limit: ZaiQuotaLimit,
  cycle: MetricCycle,
  unit: string | undefined,
): QuotaMetric {
  const counts = usageCounts(limit);
  return {
    ...identity,
    type: "quota",
    usedRatio:
      counts === undefined
        ? clampRatio(limit.percentage / 100)
        : counts.used / counts.limit,
    ...(counts === undefined
      ? {}
      : { used: counts.used, limit: counts.limit, ...(unit ? { unit } : {}) }),
    cycle,
  };
}

function planMetric(
  window: PlanWindow,
  limit: ZaiQuotaLimit,
  now: number,
): QuotaMetric {
  const resetsAt = resetsAtWithin(limit, now, window.durationMs);
  return quotaMetric(
    { id: window.id, label: window.label, scope: "general" },
    limit,
    {
      cadence: "rolling",
      ...(resetsAt === undefined
        ? {}
        : { resetsAt, durationMs: window.durationMs }),
    },
    limit.type === "CREDIT_LIMIT" ? "credits" : "tokens",
  );
}

function mcpMetric(limit: ZaiQuotaLimit, now: number): QuotaMetric {
  const resetsAt = resetsAtWithin(limit, now, undefined);
  return quotaMetric(
    { id: "mcp", label: "MCP tools", scope: "feature" },
    limit,
    resetsAt === undefined ? {} : { resetsAt },
    "calls",
  );
}

// Only the plan level is kept; free-text plan names are not stored.
function planLabel(level: string | null | undefined): string | undefined {
  return level?.trim() || undefined;
}

function snapshotFromBody(
  body: unknown,
  now: number,
): { snapshot: UsageSnapshot } | { health: ProviderHealth } {
  const envelope = zaiQuotaEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return { health: { kind: "provider_changed" } };
  }
  const code = bodyCode(envelope.data.code);
  if (envelope.data.success !== true || (code !== undefined && code !== 200)) {
    return { health: healthForBodyError(code) };
  }
  const data = envelope.data.data;
  if (!data) {
    return { health: { kind: "provider_changed" } };
  }
  // A key without an active Coding Plan returns no limits to read.
  if (data.limits.length === 0) {
    return { health: { kind: "credential_scope_required" } };
  }

  const windows = new Map<PlanWindow["id"], QuotaMetric>();
  let mcp: QuotaMetric | undefined;
  for (const raw of data.limits) {
    const parsed = zaiQuotaLimitSchema.safeParse(raw);
    if (!parsed.success) continue;
    const limit = parsed.data;
    const window = planWindow(limit);
    if (window && !windows.has(window.id)) {
      windows.set(window.id, planMetric(window, limit, now));
    } else if (limit.type === "TIME_LIMIT" && mcp === undefined) {
      mcp = mcpMetric(limit, now);
    }
  }

  const planMetrics = [FIVE_HOUR_WINDOW, WEEKLY_WINDOW]
    .map((window) => windows.get(window.id))
    .filter((metric): metric is QuotaMetric => metric !== undefined);
  if (planMetrics.length === 0) {
    return { health: { kind: "provider_changed" } };
  }

  const label = planLabel(data.level);
  return {
    snapshot: {
      providerKind: "zai",
      ...(label === undefined ? {} : { planLabel: label }),
      source: "api-key",
      fetchedAt: now,
      metrics: mcp ? [...planMetrics, mcp] : planMetrics,
      usageGroups: [
        {
          id: "usage",
          label: "Usage",
          metricIds: planMetrics.map((metric) => metric.id),
        },
        ...(mcp
          ? [{ id: "mcp-tools", label: "MCP tools", metricIds: [mcp.id] }]
          : []),
      ],
    },
  };
}

async function collectZai({
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

  let response: Response;
  try {
    response = await fetch(QUOTA_LIMIT_URL, {
      method: "GET",
      headers: requestHeaders(apiKey),
      signal,
    });
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }

  if (!response.ok) {
    return { ok: false, health: healthForResponse(response, now) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, health: { kind: "provider_changed" } };
  }

  const result = snapshotFromBody(body, now);
  return "snapshot" in result
    ? { ok: true, snapshot: result.snapshot }
    : { ok: false, health: result.health };
}

export const zaiAdapter: ProviderCollector<"zai"> = {
  id: "zai",
  collect: collectZai,
};
