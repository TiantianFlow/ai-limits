import type {
  BalanceMetric,
  CounterMetric,
  ProviderHealth,
  QuotaMetric,
} from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { retryAtFromResponse } from "../retry-after";
import type { CursorDashboardJson } from "./page-dashboard";
import {
  cursorCreditGrantSchema,
  cursorCreditGrantsBalanceSchema,
  cursorGrokStatusSchema,
  cursorUsageSummarySchema,
  type CursorCreditGrant,
  type CursorCreditGrantsBalance,
  type CursorGrokStatus,
  type CursorPlanQuota,
  type CursorQuota,
  type CursorUsageSummary,
} from "./schema";

const USAGE_ENDPOINT = "https://cursor.com/api/usage-summary";

const REQUEST_INIT = {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
} as const;

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401) return { kind: "signed_out" };
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

function onDemandCounter(summary: CursorUsageSummary): CounterMetric[] {
  const individual = summary.individualUsage?.onDemand;
  const team = summary.teamUsage?.onDemand;
  const onDemand = individual?.enabled ? individual : team?.enabled ? team : undefined;
  if (!onDemand || !supplied(onDemand.used)) return [];

  return [{
    type: "counter",
    id: "on-demand",
    label: "On-demand spend",
    scope: "product",
    semantic: "spent",
    unit: "USD",
    value: onDemand.used / 100,
    ...(supplied(onDemand.limit) && onDemand.limit > 0
      ? { limit: onDemand.limit / 100 }
      : {}),
  }];
}

function normalizeQuotas(summary: CursorUsageSummary): QuotaMetric[] {
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
    scope: QuotaMetric["scope"],
    usedRatio: number,
  ): QuotaMetric => ({
    type: "quota",
    id,
    label,
    scope,
    usedRatio,
    cycle: {
      cadence: "calendar",
      startedAt,
      resetsAt,
      durationMs: resetsAt - startedAt,
    },
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
    : [monthlyWindow("monthly", "Monthly usage", "general", fallback)];
}

function normalizeDashboardJson<T, Metric extends QuotaMetric | BalanceMetric>(
  value: unknown,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  normalize: (value: T) => Metric | undefined,
): Metric | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? normalize(parsed.data) : undefined;
}

function normalizeGrokStatus(status: CursorGrokStatus): QuotaMetric | undefined {
  if (
    !status.hasAvailableUsage ||
    !status.hasNonZeroIncludedLimit ||
    status.usagePercent === undefined ||
    status.currentPeriodStart === undefined ||
    status.nextResetTimestampUtc === undefined
  ) {
    return undefined;
  }

  const startedAt = Date.parse(status.currentPeriodStart);
  const resetsAt = Date.parse(status.nextResetTimestampUtc);
  const usedRatio = percentage(status.usagePercent);
  if (
    usedRatio === undefined ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(resetsAt) ||
    resetsAt <= startedAt
  ) {
    return undefined;
  }

  return {
    type: "quota",
    id: "grok-bot-weekly",
    label: "Grok Bot",
    scope: "feature",
    usedRatio,
    cycle: {
      cadence: "rolling",
      startedAt,
      resetsAt,
      durationMs: resetsAt - startedAt,
    },
  };
}

type CursorCreditAmounts = Pick<
  CursorCreditGrantsBalance | CursorCreditGrant,
  "total_cents" | "used_cents" | "totalCents" | "usedCents"
>;

type CreditRemainder =
  | { kind: "absent" }
  | { kind: "incomplete" }
  | { kind: "invalid" }
  | { kind: "valid"; remainingCents: number };

function safeCents(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function remainingCreditCents(credit: CursorCreditAmounts): CreditRemainder {
  const snakePresent =
    supplied(credit.total_cents) || supplied(credit.used_cents);
  const camelPresent = supplied(credit.totalCents) || supplied(credit.usedCents);
  const snakeComplete =
    supplied(credit.total_cents) && supplied(credit.used_cents);
  const camelComplete =
    supplied(credit.totalCents) && supplied(credit.usedCents);
  if (!snakePresent && !camelPresent) return { kind: "absent" };
  if (snakePresent && camelPresent) return { kind: "invalid" };
  if (!snakeComplete && !camelComplete) return { kind: "incomplete" };

  const totalCents = snakeComplete ? credit.total_cents : credit.totalCents;
  const usedCents = snakeComplete ? credit.used_cents : credit.usedCents;
  if (
    !safeCents(totalCents) ||
    !safeCents(usedCents) ||
    usedCents > totalCents
  ) {
    return { kind: "invalid" };
  }

  return { kind: "valid", remainingCents: totalCents - usedCents };
}

function normalizeExtraUsageCredits(
  balance: CursorCreditGrantsBalance,
): BalanceMetric | undefined {
  const aggregate = remainingCreditCents(balance);
  let remainingCents: number | undefined;
  if (aggregate.kind === "valid") {
    remainingCents = aggregate.remainingCents;
  } else if (aggregate.kind === "invalid") {
    return undefined;
  } else {
    const grantsAliases = [
      balance.credit_grants,
      balance.creditGrants,
      balance.grants,
    ].filter((grants) => grants !== undefined);
    const [grants] = grantsAliases;
    if (grantsAliases.length !== 1 || !Array.isArray(grants)) return undefined;

    const parsedGrants = grants.map((grant) =>
      cursorCreditGrantSchema.safeParse(grant),
    );
    if (parsedGrants.some((grant) => !grant.success)) return undefined;

    let total = 0;
    for (const grant of parsedGrants) {
      if (!grant.success) return undefined;
      const remainder = remainingCreditCents(grant.data);
      if (remainder.kind !== "valid") return undefined;
      total += remainder.remainingCents;
      if (!Number.isSafeInteger(total)) return undefined;
    }
    remainingCents = total;
  }

  if (remainingCents === undefined || remainingCents <= 0) return undefined;

  return {
    type: "balance",
    id: "extra-usage-credits",
    label: "Extra usage credits",
    scope: "product",
    unit: "USD",
    value: remainingCents / 100,
  };
}

export async function collectCursor(
  { fetch, now, signal }: CollectionContext,
  dashboard: CursorDashboardJson = {},
): Promise<CollectionResult> {
  try {
    const response = await fetch(USAGE_ENDPOINT, { ...REQUEST_INIT, signal });
    if (!response.ok) {
      return { ok: false, health: healthForResponse(response, now) };
    }
    const parsed = cursorUsageSummarySchema.safeParse(await parseJson(response));
    if (!parsed.success || !summaryIsSemanticallyValid(parsed.data)) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const quotas = normalizeQuotas(parsed.data);
    if (quotas.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }
    const counters = onDemandCounter(parsed.data);
    const grok = normalizeDashboardJson(
      dashboard.grok,
      cursorGrokStatusSchema,
      normalizeGrokStatus,
    );
    const extraUsageCredits = normalizeDashboardJson(
      dashboard["credits"],
      cursorCreditGrantsBalanceSchema,
      normalizeExtraUsageCredits,
    );
    const metrics = [
      ...quotas,
      ...counters,
      ...(grok === undefined ? [] : [grok]),
      ...(extraUsageCredits === undefined ? [] : [extraUsageCredits]),
    ];
    return {
      ok: true,
      snapshot: {
        providerKind: "cursor",
        planLabel: parsed.data.membershipType,
        source: "web-session",
        fetchedAt: now,
        metrics,
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: metrics.map((metric) => metric.id),
          },
        ],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const cursorAdapter: ProviderCollector<"cursor"> = {
  id: "cursor",
  collect: collectCursor,
};
