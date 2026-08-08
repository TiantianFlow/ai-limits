import type { CreditBalance, ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  cursorIdentitySchema,
  cursorUsageSummarySchema,
  type CursorPlanQuota,
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

function supplied(value: number | null | undefined): value is number {
  return value !== undefined && value !== null;
}

function percentage(value: number | null | undefined): number | undefined {
  return supplied(value) && value >= 0 && value <= 100 ? value / 100 : undefined;
}

function amountsAreValid(quota: CursorQuota): boolean {
  const amounts = [quota.used, quota.limit, quota.remaining].filter(supplied);
  if (amounts.some((amount) => amount < 0)) return false;
  if (supplied(quota.used) && supplied(quota.limit) && quota.used > quota.limit) {
    return false;
  }
  if (
    supplied(quota.remaining) &&
    supplied(quota.limit) &&
    quota.remaining > quota.limit
  ) {
    return false;
  }
  if (supplied(quota.used) && supplied(quota.limit) && supplied(quota.remaining)) {
    const difference = Math.abs(quota.used + quota.remaining - quota.limit);
    const scale = Math.max(1, quota.limit);
    if (difference > Number.EPSILON * scale * 4) return false;
  }
  return true;
}

function planPercentagesAreValid(plan: CursorPlanQuota): boolean {
  return [plan.totalPercentUsed, plan.autoPercentUsed, plan.apiPercentUsed].every(
    (value) => !supplied(value) || percentage(value) !== undefined,
  );
}

function quotaRatio(quota: CursorQuota | null | undefined): number | undefined {
  if (
    !quota?.enabled ||
    !supplied(quota.used) ||
    !supplied(quota.limit) ||
    quota.limit <= 0
  ) {
    return undefined;
  }
  return quota.used / quota.limit;
}

function planRatio(plan: CursorPlanQuota | null | undefined): number | undefined {
  if (!plan?.enabled) return undefined;
  if (supplied(plan.totalPercentUsed)) return percentage(plan.totalPercentUsed);

  const lanes = [plan.autoPercentUsed, plan.apiPercentUsed]
    .filter(supplied)
    .map((value) => percentage(value));
  if (lanes.length > 0) {
    return Math.max(...lanes.filter((ratio): ratio is number => ratio !== undefined));
  }
  return quotaRatio(plan);
}

function usageRatio(summary: CursorUsageSummary): number | undefined {
  return (
    planRatio(summary.individualUsage?.plan) ??
    quotaRatio(summary.individualUsage?.overall) ??
    quotaRatio(summary.teamUsage?.pooled)
  );
}

function summaryIsSemanticallyValid(summary: CursorUsageSummary): boolean {
  const quotas = [
    summary.individualUsage?.plan,
    summary.individualUsage?.overall,
    summary.individualUsage?.onDemand,
    summary.teamUsage?.pooled,
    summary.teamUsage?.onDemand,
  ].filter((quota): quota is CursorQuota => quota !== undefined && quota !== null);
  const plan = summary.individualUsage?.plan;

  return (
    quotas.every(amountsAreValid) &&
    (!plan || planPercentagesAreValid(plan))
  );
}

function onDemandCredit(summary: CursorUsageSummary): CreditBalance[] {
  const individual = summary.individualUsage?.onDemand;
  const team = summary.teamUsage?.onDemand;
  const onDemand = individual?.enabled ? individual : team?.enabled ? team : undefined;
  if (!onDemand || !supplied(onDemand.used)) return [];

  return [{
    id: "on-demand",
    label: "On-demand spend",
    unit: "USD",
    used: onDemand.used / 100,
    ...(supplied(onDemand.limit) ? { limit: onDemand.limit / 100 } : {}),
  }];
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

async function identityLabels(fetch: typeof globalThis.fetch, signal: AbortSignal) {
  try {
    const response = await fetch(IDENTITY_ENDPOINT, { ...REQUEST_INIT, signal });
    if (!response.ok) return {};
    const identity = cursorIdentitySchema.safeParse(await parseJson(response));
    if (!identity.success) return {};
    const explicitPlan = identity.data.planName ?? identity.data.plan;
    return {
      ...(identity.data.email ? { accountLabel: identity.data.email } : {}),
      ...(explicitPlan ? { planLabel: explicitPlan } : {}),
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
    if (!parsed.success || !summaryIsSemanticallyValid(parsed.data)) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const window = normalizeWindow(parsed.data);
    if (!window) return { ok: false, health: { kind: "provider_changed" } };
    const identity = await identityLabels(fetch, signal);
    return {
      ok: true,
      snapshot: {
        providerId: "cursor",
        planLabel: parsed.data.membershipType,
        ...identity,
        source: "web-session",
        fetchedAt: now,
        windows: [window],
        credits: onDemandCredit(parsed.data),
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
