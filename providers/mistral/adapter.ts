import type {
  BalanceMetric,
  CounterMetric,
  ProviderHealth,
  UsageMetric,
} from "../../domain/model";
import { z } from "zod";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { retryAtFromResponse } from "../retry-after";
import {
  mistralBillingResponseSchema,
  mistralCreditsResponseSchema,
} from "./schema";

// Wire behavior follows the upstream reference implementation. Chrome cannot
// read cookie values, so the optional CSRF header is omitted and same-origin
// cookies are attached by Chrome. Costs sum per-entry completion-model spend;
// token totals prefer value_paid over value. Available credits are wallet plus
// credit notes minus ongoing usage, clamped at zero.

const USAGE_ENDPOINT = "https://admin.mistral.ai/api/billing/v2/usage";
const CREDITS_ENDPOINT = "https://admin.mistral.ai/api/billing/credits";

const USAGE_HEADERS = {
  Accept: "*/*",
  Referer: "https://admin.mistral.ai/organization/usage", // :39
  Origin: "https://admin.mistral.ai", // :40
} as const;

const CREDITS_HEADERS = {
  Accept: "*/*",
  Referer: "https://admin.mistral.ai/organization/billing", // :109
  Origin: "https://admin.mistral.ai", // :110
} as const;

function healthForResponse(response: Response, now: number): ProviderHealth {
  // 401 and 403 both mean the signed-in session is gone.
  if (response.status === 401 || response.status === 403) {
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

function usageUrl(now: number): string {
  // Calendar month and year are computed in UTC.
  const date = new Date(now);
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const url = new URL(USAGE_ENDPOINT);
  url.searchParams.set("month", String(month));
  url.searchParams.set("year", String(year));
  return url.toString();
}

interface MistralTotals {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

function sumCompletionUsage(
  billing: z.infer<typeof mistralBillingResponseSchema>,
): MistralTotals | undefined {
  // Price index keyed by "metric::group".
  const prices = new Map<string, number>();
  for (const price of billing.prices ?? []) {
    if (
      price.billing_metric === undefined ||
      price.billing_group === undefined ||
      price.price === undefined
    ) {
      continue;
    }
    const value = Number(price.price);
    if (!Number.isFinite(value)) continue;
    prices.set(`${price.billing_metric}::${price.billing_group}`, value);
  }

  const models = billing.completion?.models;
  if (!models) {
    return undefined;
  }

  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  for (const modelData of Object.values(models)) {
    const buckets = [
      { entries: modelData.input ?? [], kind: "input" as const },
      { entries: modelData.output ?? [], kind: "output" as const },
      { entries: modelData.cached ?? [], kind: "cached" as const },
    ];
    for (const { entries, kind } of buckets) {
      for (const entry of entries ?? []) {
        // Prefer value_paid over value.
        const tokens = entry.value_paid ?? entry.value ?? 0;
        if (!Number.isFinite(tokens) || tokens < 0) continue;
        if (kind === "input") inputTokens += tokens;
        else if (kind === "output") outputTokens += tokens;
        else cachedTokens += tokens;
        // Cost is tokens * price["metric::group"], or zero when unknown.
        if (entry.billing_metric !== undefined && entry.billing_group !== undefined) {
          const unitPrice =
            prices.get(`${entry.billing_metric}::${entry.billing_group}`) ?? 0;
          const cost = tokens * unitPrice;
          if (Number.isFinite(cost)) totalCost += cost;
        }
      }
    }
  }

  if (!Number.isFinite(totalCost)) return undefined;
  return { totalCost, inputTokens, outputTokens, cachedTokens };
}

function normalizeCurrency(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? "XXX" : trimmed.toUpperCase();
}

async function collectMistral({
  fetch: injectedFetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const usageResponse = await injectedFetch(usageUrl(now), {
      method: "GET",
      credentials: "include",
      headers: USAGE_HEADERS,
      signal,
    });
    if (!usageResponse.ok) {
      return { ok: false, health: healthForResponse(usageResponse, now) };
    }

    const billing = mistralBillingResponseSchema.safeParse(
      await parseJson(usageResponse),
    );
    if (!billing.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const totals = sumCompletionUsage(billing.data);
    if (totals === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const currency = normalizeCurrency(billing.data.currency);
    const metrics: UsageMetric[] = [];
    // Negative totalCost means a refund adjustment; clamp to zero.
    const monthSpend: CounterMetric = {
      type: "counter",
      id: "month-spend",
      label: "Spend this month",
      scope: "general",
      semantic: "spent",
      unit: currency,
      value: Math.max(0, totals.totalCost),
      cycle: { cadence: "calendar" },
    };
    metrics.push(monthSpend);

    // Credits are a secondary probe: a failed or missing credits call must not
    // erase the independently collected spend metric.
    let credits: BalanceMetric | undefined;
    try {
      const creditsResponse = await injectedFetch(CREDITS_ENDPOINT, {
        method: "GET",
        credentials: "include",
        headers: CREDITS_HEADERS,
        signal,
      });
      if (creditsResponse.ok) {
        const parsed = mistralCreditsResponseSchema.safeParse(
          await parseJson(creditsResponse),
        );
        if (parsed.success) {
          const available =
            parsed.data.wallet_amount +
            (parsed.data.credit_notes_amount ?? 0) -
            (parsed.data.ongoing_usage_balance ?? 0);
          if (Number.isFinite(available)) {
            credits = {
              type: "balance",
              id: "credits",
              label: "Credits",
              scope: "product",
              unit: parsed.data.currency.toUpperCase(),
              value: Math.max(0, available),
            };
          }
        }
      }
    } catch {
      if (signal.aborted) throw new Error("aborted");
      credits = undefined;
    }
    if (credits !== undefined) {
      metrics.push(credits);
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "mistral",
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

export const mistralAdapter: ProviderCollector<"mistral"> = {
  id: "mistral",
  collect: collectMistral,
};
