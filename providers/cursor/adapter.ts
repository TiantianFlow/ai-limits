import type { ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  cursorIdentitySchema,
  cursorUsageSummarySchema,
  type CursorQuota,
  type CursorUsageSummary,
} from "./schema";

const CURSOR_ORIGIN = "https://cursor.com/*";
const USAGE_ENDPOINT = "https://cursor.com/api/usage-summary";
const IDENTITY_ENDPOINT = "https://cursor.com/api/auth/me";

const REQUEST_INIT = {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
} as const;

function healthForStatus(status: number): ProviderHealth {
  if (status === 401) return { kind: "signed_out" };
  if (status === 429 || status >= 500) return { kind: "temporary_error" };
  return { kind: "provider_changed" };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function percentage(value: number | undefined): number | undefined {
  return value !== undefined && value >= 0 && value <= 100 ? value / 100 : undefined;
}

function validQuota(quota: CursorQuota | undefined): number | undefined {
  if (!quota) return undefined;
  const fromPercent = percentage(quota.percentUsed);
  if (quota.percentUsed !== undefined && fromPercent === undefined) return undefined;
  if (fromPercent !== undefined) return fromPercent;
  if (
    quota.used === undefined ||
    quota.limit === undefined ||
    quota.limit <= 0 ||
    quota.used < 0 ||
    quota.used > quota.limit
  ) return undefined;
  return quota.used / quota.limit;
}

function quotaIsValidWhenPresent(quota: CursorQuota | undefined): boolean {
  return quota === undefined || validQuota(quota) !== undefined;
}

function laneRatio(summary: CursorUsageSummary): number | undefined {
  const lanes = [...(summary.lanes ?? []), ...(summary.usageLanes ?? [])];
  if (lanes.length === 0) return undefined;
  const ratios = lanes.map(validQuota);
  return ratios.every((ratio): ratio is number => ratio !== undefined)
    ? Math.max(...ratios)
    : undefined;
}

function usageRatio(summary: CursorUsageSummary): number | undefined {
  const total = percentage(summary.totalPercentUsed);
  if (summary.totalPercentUsed !== undefined) return total;

  return (
    laneRatio(summary) ??
    validQuota(summary.planUsage) ??
    validQuota(summary.overallUsage) ??
    validQuota(summary.enterpriseUsage) ??
    validQuota(summary.teamUsage) ??
    validQuota(summary.pooledUsage)
  );
}

function summaryIsSemanticallyValid(summary: CursorUsageSummary): boolean {
  return (
    (summary.totalPercentUsed === undefined || percentage(summary.totalPercentUsed) !== undefined) &&
    quotaIsValidWhenPresent(summary.planUsage) &&
    quotaIsValidWhenPresent(summary.overallUsage) &&
    quotaIsValidWhenPresent(summary.enterpriseUsage) &&
    quotaIsValidWhenPresent(summary.teamUsage) &&
    quotaIsValidWhenPresent(summary.pooledUsage) &&
    [...(summary.lanes ?? []), ...(summary.usageLanes ?? [])].every(quotaIsValidWhenPresent)
  );
}

function onDemandCredit(summary: CursorUsageSummary) {
  const used = summary.onDemandUsage?.used;
  if (used === undefined) return [];
  if (used < 0) return undefined;
  return [{ id: "on-demand", label: "On-demand spend", unit: "USD", used: used / 100 }];
}

function normalizeWindow(summary: CursorUsageSummary): QuotaWindow | undefined {
  const ratio = usageRatio(summary);
  const startedAt = Date.parse(summary.billingCycleStart);
  const resetsAt = Date.parse(summary.billingCycleEnd);
  if (
    ratio === undefined ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(resetsAt) ||
    resetsAt <= startedAt
  ) return undefined;
  return {
    id: "monthly",
    label: "Monthly usage",
    kind: "calendar",
    usedRatio: ratio,
    startedAt,
    resetsAt,
    durationMs: resetsAt - startedAt,
    sourceSemantics: "used",
  };
}

async function identityLabel(fetch: typeof globalThis.fetch, signal: AbortSignal) {
  try {
    const response = await fetch(IDENTITY_ENDPOINT, { ...REQUEST_INIT, signal });
    if (!response.ok) return {};
    const identity = cursorIdentitySchema.safeParse(await parseJson(response));
    if (!identity.success) return {};
    return {
      ...(identity.data.email ? { accountLabel: identity.data.email } : {}),
      ...(identity.data.plan ?? identity.data.planName
        ? { planLabel: identity.data.plan ?? identity.data.planName }
        : {}),
    };
  } catch {
    return {};
  }
}

async function collectCursor({ fetch, now, signal }: CollectionContext): Promise<CollectionResult> {
  try {
    const response = await fetch(USAGE_ENDPOINT, { ...REQUEST_INIT, signal });
    if (!response.ok) return { ok: false, health: healthForStatus(response.status) };
    const parsed = cursorUsageSummarySchema.safeParse(await parseJson(response));
    if (!parsed.success) return { ok: false, health: { kind: "provider_changed" } };

    if (!summaryIsSemanticallyValid(parsed.data)) {
      return { ok: false, health: { kind: "provider_changed" } };
    }
    const window = normalizeWindow(parsed.data);
    const credits = onDemandCredit(parsed.data);
    if (!window || !credits) return { ok: false, health: { kind: "provider_changed" } };
    const identity = await identityLabel(fetch, signal);
    return {
      ok: true,
      snapshot: {
        providerId: "cursor",
        ...identity,
        source: "web-session",
        fetchedAt: now,
        windows: [window],
        credits,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const cursorAdapter: ProviderAdapter = {
  id: "cursor",
  capabilities: { browserSession: true },
  optionalOrigins: [CURSOR_ORIGIN],
  collect: collectCursor,
};
