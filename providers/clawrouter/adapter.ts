import type {
  BalanceMetric,
  CounterMetric,
  MetricCycle,
  ProviderHealth,
  UsageMetric,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { normalizeNewApiBaseUrl } from "../newapi/url";
import { clawRouterUsageSchema } from "./schema";

export const CLAWROUTER_DEFAULT_BASE_URL = "https://clawrouter.openclaw.ai";
const MICROS_PER_USD = 1_000_000;

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401) return { kind: "credential_invalid" };
  if (response.status === 403) return { kind: "credential_scope_required" };
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

function microsToUsd(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  return value / MICROS_PER_USD;
}

function monthlyReset(windowKey: string | null | undefined): number | undefined {
  if (typeof windowKey !== "string") return undefined;
  const match = windowKey.match(/(\d{4})-(\d{2})$/);
  if (!match) return undefined;
  let year = Number(match[1]);
  let month = Number(match[2]) + 1;
  if (month === 13) {
    year += 1;
    month = 1;
  }
  const resetsAt = Date.UTC(year, month - 1, 1);
  return Number.isFinite(resetsAt) ? resetsAt : undefined;
}

function budgetCycle(windowKey: string | null | undefined): MetricCycle | undefined {
  const resetsAt = monthlyReset(windowKey);
  return resetsAt === undefined
    ? undefined
    : { cadence: "calendar", resetsAt };
}

function monthlyBudget(
  spentUsd: number,
  limitUsd: number,
  remainingUsd: number | undefined,
  cycle: MetricCycle | undefined,
): BalanceMetric | undefined {
  if (!(limitUsd > 0) || !Number.isFinite(spentUsd)) return undefined;
  const remaining =
    remainingUsd !== undefined && Number.isFinite(remainingUsd)
      ? remainingUsd
      : limitUsd - spentUsd;
  if (!Number.isFinite(remaining)) return undefined;
  return {
    type: "balance",
    id: "monthly-budget",
    label: "Monthly budget",
    scope: "product",
    value: remaining,
    unit: "USD",
    initialLimit: limitUsd,
    ...(cycle === undefined ? {} : { cycle }),
  };
}

function actualCost(actualCostUsd: number): CounterMetric {
  return {
    type: "counter",
    id: "actual-cost",
    label: "Actual cost",
    scope: "product",
    semantic: "spent",
    value: actualCostUsd,
    unit: "USD",
  };
}

async function collectClawRouter({
  baseUrl: configuredBaseUrl,
  credential,
  fetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  const baseUrl =
    normalizeNewApiBaseUrl(configuredBaseUrl) ??
    normalizeNewApiBaseUrl(CLAWROUTER_DEFAULT_BASE_URL);
  const apiKey = credential?.kind === "api-key" ? credential.value.trim() : "";
  if (!baseUrl || !apiKey) {
    return { ok: false, health: { kind: "signed_out" } };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/usage`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });
    if (!response.ok) {
      return { ok: false, health: healthForResponse(response, now) };
    }

    const parsed = clawRouterUsageSchema.safeParse(await parseJson(response));
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const { budget, usage } = parsed.data;
    const limitUsd = microsToUsd(budget.limitMicros);
    const spentUsd = microsToUsd(budget.spentMicros);
    const remainingUsd = microsToUsd(budget.remainingMicros);
    const cycle = budgetCycle(budget.windowKey);
    const metrics: UsageMetric[] = [];

    if (
      budget.configured &&
      limitUsd !== undefined &&
      spentUsd !== undefined
    ) {
      const budgetMetric = monthlyBudget(spentUsd, limitUsd, remainingUsd, cycle);
      if (budgetMetric) metrics.push(budgetMetric);
    }

    if (metrics.length === 0) {
      metrics.push(actualCost(usage.summary.actualCostMicros / MICROS_PER_USD));
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "clawrouter",
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const clawRouterAdapter = {
  id: "clawrouter",
  collect: collectClawRouter,
} satisfies ProviderCollector<"clawrouter">;
