import type {
  ProviderHealth,
  QuotaMetric,
} from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { retryAtFromResponse } from "../retry-after";
import {
  perplexityCreditsResponseSchema,
  type PerplexityCreditsResponse,
} from "./schema";

// Wire behavior follows the upstream reference implementation. Chrome attaches
// same-origin cookies itself. Grants use recurring -> purchased -> promotional
// waterfall attribution; purchased totals use the larger of the grant sum and
// top-level field. Timestamps are Unix seconds.

const CREDITS_ENDPOINT =
  "https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default";

const REQUEST_HEADERS = {
  Accept: "application/json",
  Origin: "https://www.perplexity.ai",
  Referer: "https://www.perplexity.ai/account/usage",
} as const;

function healthForResponse(response: Response, now: number): ProviderHealth {
  // 401 and 403 both mean the session token is invalid.
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

interface PerplexityPools {
  recurringTotal: number;
  recurringUsed: number;
  promoTotal: number;
  promoUsed: number;
  purchasedTotal: number;
  purchasedUsed: number;
  renewalDateMs: number;
  promoExpirationMs: number | undefined;
}

function bucketPools(
  response: PerplexityCreditsResponse,
  now: number,
): PerplexityPools {
  const nowSeconds = now / 1_000;
  const recurring = response.credit_grants.filter(
    (grant) => grant.type === "recurring",
  );
  const promotional = response.credit_grants.filter(
    (grant) =>
      grant.type === "promotional" &&
      (grant.expires_at_ts ?? Number.POSITIVE_INFINITY) > nowSeconds,
  );
  const purchased = response.credit_grants.filter(
    (grant) => grant.type === "purchased",
  );

  // Sums are clamped at zero.
  const recurringTotal = Math.max(
    0,
    recurring.reduce((sum, grant) => sum + grant.amount_cents, 0),
  );
  const promoTotal = Math.max(
    0,
    promotional.reduce((sum, grant) => sum + grant.amount_cents, 0),
  );
  // Take the larger of the grant sum and top-level field.
  const purchasedFromGrants = Math.max(
    0,
    purchased.reduce((sum, grant) => sum + grant.amount_cents, 0),
  );
  const purchasedTotal = Math.max(
    purchasedFromGrants,
    Math.max(0, response.current_period_purchased_cents),
  );

  // Waterfall attribution.
  let remaining = response.total_usage_cents;
  const recurringUsed = Math.min(remaining, recurringTotal);
  remaining -= recurringUsed;
  const purchasedUsed = Math.min(remaining, purchasedTotal);
  remaining -= purchasedUsed;
  const promoUsed = Math.min(remaining, promoTotal);

  // Earliest promotional expiry.
  const promoExpiries = promotional
    .map((grant) => grant.expires_at_ts)
    .filter((value): value is number => value !== undefined && value !== null);
  const promoExpirationMs =
    promoExpiries.length === 0
      ? undefined
      : Math.min(...promoExpiries) * 1_000;

  return {
    recurringTotal,
    recurringUsed,
    promoTotal,
    promoUsed,
    purchasedTotal,
    purchasedUsed,
    // Convert Unix seconds to milliseconds.
    renewalDateMs: response.renewal_date_ts * 1_000,
    promoExpirationMs,
  };
}

// Infer plan name from recurring allotment.
function planName(recurringTotal: number): string | undefined {
  if (recurringTotal <= 0) return undefined;
  return recurringTotal < 5_000 ? "Pro" : "Max";
}

function creditQuota(
  pools: PerplexityPools,
  pool: "recurring" | "purchased" | "promo",
): QuotaMetric {
  const identity =
    pool === "recurring"
      ? { id: "recurring-credits", label: "Monthly recurring credits" }
      : pool === "purchased"
        ? { id: "purchased-credits", label: "Purchased credits" }
        : { id: "promo-credits", label: "Promotional bonus credits" };
  const total =
    pool === "recurring"
      ? pools.recurringTotal
      : pool === "purchased"
        ? pools.purchasedTotal
        : pools.promoTotal;
  const used =
    pool === "recurring"
      ? pools.recurringUsed
      : pool === "purchased"
        ? pools.purchasedUsed
        : pools.promoUsed;

  // The upstream reference implementation renders an absent pool as 100% used.
  const usedRatio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 1;

  return {
    ...identity,
    type: "quota",
    scope: "product",
    usedRatio,
    used: used / 100,
    limit: total / 100,
    unit: "USD",
    cycle:
      pool === "recurring"
        ? { cadence: "calendar", resetsAt: pools.renewalDateMs }
        : pool === "promo" && pools.promoExpirationMs !== undefined
          ? { resetsAt: pools.promoExpirationMs }
          : {},
  };
}

async function collectPerplexity({
  fetch: injectedFetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const response = await injectedFetch(CREDITS_ENDPOINT, {
      method: "GET",
      credentials: "include",
      headers: REQUEST_HEADERS,
      signal,
    });
    if (!response.ok) {
      return { ok: false, health: healthForResponse(response, now) };
    }

    const credits = perplexityCreditsResponseSchema.safeParse(
      await parseJson(response),
    );
    if (!credits.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const pools = bucketPools(credits.data, now);
    const metrics = [
      creditQuota(pools, "recurring"),
      creditQuota(pools, "promo"),
      creditQuota(pools, "purchased"),
    ];
    const label = planName(pools.recurringTotal);

    return {
      ok: true,
      snapshot: {
        providerKind: "perplexity",
        ...(label === undefined ? {} : { planLabel: label }),
        source: "web-session",
        fetchedAt: now,
        metrics,
        usageGroups: [
          {
            id: "credits",
            label: "Credits",
            metricIds: metrics.map((metric) => metric.id),
          },
        ],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const perplexityAdapter: ProviderCollector<"perplexity"> = {
  id: "perplexity",
  collect: collectPerplexity,
};
