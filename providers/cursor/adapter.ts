import type { CreditBalance, ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  cursorUsageSummarySchema,
  type CursorPlanQuota,
  type CursorQuota,
  type CursorUsageSummary,
} from "./schema";

const CURSOR_ORIGIN = "https://cursor.com/*";
const USAGE_ENDPOINT = "https://cursor.com/api/usage-summary";

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
  return quotaRatio(plan);
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

function normalizeWindows(summary: CursorUsageSummary): QuotaWindow[] {
  const startedAt = Date.parse(summary.billingCycleStart);
  const resetsAt = Date.parse(summary.billingCycleEnd);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(resetsAt) ||
    resetsAt <= startedAt
  ) return [];

  const monthlyWindow = (
    id: string,
    label: string,
    kind: QuotaWindow["kind"],
    usedRatio: number,
  ): QuotaWindow => ({
    id,
    label,
    kind,
    usedRatio,
    startedAt,
    resetsAt,
    durationMs: resetsAt - startedAt,
    sourceSemantics: "used",
  });

  const plan = summary.individualUsage?.plan;
  if (plan?.enabled) {
    const lanes = [
      ["cursor-models-monthly", "Cursor models", percentage(plan.autoPercentUsed)],
      ["other-models-monthly", "Other models", percentage(plan.apiPercentUsed)],
    ] as const;
    const laneWindows = lanes.flatMap(([id, label, ratio]) =>
      ratio === undefined ? [] : [monthlyWindow(id, label, "model", ratio)],
    );
    if (laneWindows.length > 0) return laneWindows;
  }

  const fallback =
    planRatio(plan) ??
    quotaRatio(summary.individualUsage?.overall) ??
    quotaRatio(summary.teamUsage?.pooled);
  return fallback === undefined
    ? []
    : [monthlyWindow("monthly", "Monthly usage", "calendar", fallback)];
}

async function collectCursor({ fetch, now, signal }: CollectionContext): Promise<CollectionResult> {
  try {
    const response = await fetch(USAGE_ENDPOINT, { ...REQUEST_INIT, signal });
    if (!response.ok) return { ok: false, health: healthForStatus(response.status) };
    const parsed = cursorUsageSummarySchema.safeParse(await parseJson(response));
    if (!parsed.success || !summaryIsSemanticallyValid(parsed.data)) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const windows = normalizeWindows(parsed.data);
    if (windows.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }
    return {
      ok: true,
      snapshot: {
        providerId: "cursor",
        planLabel: parsed.data.membershipType,
        source: "web-session",
        fetchedAt: now,
        windows,
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
