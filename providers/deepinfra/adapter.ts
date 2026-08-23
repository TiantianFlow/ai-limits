import type {
  BalanceMetric,
  ProviderHealth,
  QuotaMetric,
  UsageMetric,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  deepInfraChecklistSchema,
  deepInfraUsageSchema,
  type DeepInfraChecklist,
} from "./schema";

const CHECKLIST_ENDPOINT =
  "https://api.deepinfra.com/payment/checklist?compute_owed=true";
const USAGE_ENDPOINT = "https://api.deepinfra.com/payment/usage?from=current";

// The usage endpoint reports `total_cost` in cents; checklist money is USD.
const CENTS_PER_DOLLAR = 100;

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

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function spendingQuota(
  used: number,
  limit: number,
): QuotaMetric | undefined {
  if (
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    used < 0
  ) {
    return undefined;
  }

  return {
    type: "quota",
    id: "spending-limit",
    label: "Spending limit",
    scope: "product",
    usedRatio: used / limit,
    used,
    limit,
    unit: "USD",
  };
}

function stripeBalance(value: number): BalanceMetric | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return {
    type: "balance",
    id: "balance",
    label: "Balance",
    scope: "general",
    value,
    unit: "USD",
  };
}

function normalizeMetrics(
  checklist: DeepInfraChecklist,
  currentMonthCost: number,
): UsageMetric[] {
  const metrics: UsageMetric[] = [];
  const limit =
    checklist.limit !== null && checklist.limit !== undefined && checklist.limit > 0
      ? checklist.limit
      : undefined;

  if (limit !== undefined) {
    const quota = spendingQuota(currentMonthCost, limit);
    if (quota !== undefined) metrics.push(quota);
  } else {
    const balance = stripeBalance(checklist.stripe_balance);
    if (balance !== undefined) metrics.push(balance);
  }

  return metrics;
}

async function collectDeepInfra({
  credential,
  fetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  if (
    credential?.kind !== "api-key" ||
    typeof credential.value !== "string" ||
    !credential.value.trim()
  ) {
    return { ok: false, health: { kind: "signed_out" } };
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credential.value.trim()}`,
  };

  try {
    const checklistResponse = await fetch(CHECKLIST_ENDPOINT, {
      method: "GET",
      headers,
      signal,
    });
    if (!checklistResponse.ok) {
      return { ok: false, health: healthForResponse(checklistResponse, now) };
    }

    const checklist = deepInfraChecklistSchema.safeParse(
      await parseJson(checklistResponse),
    );
    if (!checklist.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const usageResponse = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers,
      signal,
    });
    if (!usageResponse.ok) {
      return { ok: false, health: healthForResponse(usageResponse, now) };
    }

    const usage = deepInfraUsageSchema.safeParse(await parseJson(usageResponse));
    if (!usage.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    // The upstream reference implementation takes the last month as current,
    // falling back to the checklist `recent` spend.
    const recentCost = Math.max(0, checklist.data.recent);
    const lastMonth = usage.data.months.at(-1);
    const currentMonthCost =
      lastMonth === undefined
        ? recentCost
        : Math.max(0, lastMonth.total_cost / CENTS_PER_DOLLAR);

    const metrics = normalizeMetrics(checklist.data, currentMonthCost);
    if (metrics.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "deepinfra",
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const deepInfraAdapter: ProviderCollector<"deepinfra"> = {
  id: "deepinfra",
  collect: collectDeepInfra,
};
