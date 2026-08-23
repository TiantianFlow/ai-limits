import type {
  BalanceMetric,
  MetricCycle,
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
import { normalizeNewApiBaseUrl } from "../newapi/url";
import { sub2apiUsageSchema } from "./schema";

const RATE_WINDOW_MINUTES: Record<string, number> = {
  "5h": 300,
  "1d": 1440,
  "7d": 10080,
};

const RATE_WINDOW_LABELS: Record<string, string> = {
  "5h": "5 hour limit",
  "1d": "Daily limit",
  "7d": "7 day limit",
};

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

function isoMilliseconds(value: string | null | undefined): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizedQuota(
  identity: Pick<QuotaMetric, "id" | "label" | "scope">,
  used: number | null | undefined,
  limit: number | null | undefined,
  unit: string,
  cycle: MetricCycle = {},
): QuotaMetric | undefined {
  if (
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    (limit as number) <= 0 ||
    (used as number) < 0 ||
    (used as number) > (limit as number)
  ) {
    return undefined;
  }

  return {
    type: "quota",
    ...identity,
    usedRatio: (used as number) / (limit as number),
    used: used as number,
    limit: limit as number,
    unit,
    ...(Object.keys(cycle).length === 0 ? {} : { cycle }),
  };
}

function balanceMetric(
  value: number | null | undefined,
  unit: string,
): BalanceMetric | undefined {
  if (!Number.isFinite(value)) return undefined;
  return {
    type: "balance",
    id: "balance",
    label: "Balance",
    scope: "product",
    value: value as number,
    unit,
  };
}

async function collectSub2Api({
  baseUrl: configuredBaseUrl,
  credential,
  fetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  const baseUrl = normalizeNewApiBaseUrl(configuredBaseUrl);
  const apiKey = credential?.kind === "api-key" ? credential.value.trim() : "";
  if (!baseUrl || !apiKey) {
    return { ok: false, health: { kind: "signed_out" } };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/usage?days=30&timezone=UTC`, {
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

    const parsed = sub2apiUsageSchema.safeParse(await parseJson(response));
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    if (parsed.data.isValid === false) {
      return { ok: false, health: { kind: "credential_invalid" } };
    }

    const unit = parsed.data.unit?.trim() || parsed.data.quota?.unit?.trim() || "USD";
    const metrics: UsageMetric[] = [];
    const subscription = parsed.data.subscription;
    const quota = parsed.data.quota;

    if (subscription) {
      for (const [id, label, used, limit, durationMs] of [
        [
          "daily",
          "Daily",
          subscription.daily_usage_usd ?? 0,
          subscription.daily_limit_usd,
          1_440 * 60 * 1_000,
        ],
        [
          "weekly",
          "Weekly",
          subscription.weekly_usage_usd ?? 0,
          subscription.weekly_limit_usd,
          10_080 * 60 * 1_000,
        ],
        [
          "monthly",
          "Monthly",
          subscription.monthly_usage_usd ?? 0,
          subscription.monthly_limit_usd,
          43_200 * 60 * 1_000,
        ],
      ] as const) {
        const metric = normalizedQuota(
          { id, label, scope: "product" },
          used,
          limit,
          "USD",
          { cadence: "rolling", durationMs },
        );
        if (metric) metrics.push(metric);
      }
    } else if (quota) {
      const metric = normalizedQuota(
        { id: "key-quota", label: "Key quota", scope: "feature" },
        quota.used,
        quota.limit,
        quota.unit?.trim() || unit,
      );
      if (metric) metrics.push(metric);
    }

    const wallet = balanceMetric(parsed.data.balance, unit);
    if (wallet) metrics.push(wallet);

    for (const rate of parsed.data.rate_limits ?? []) {
      const windowKey = rate.window.trim().toLowerCase();
      const minutes = RATE_WINDOW_MINUTES[windowKey];
      const resetsAt = isoMilliseconds(rate.reset_at);
      const metric = normalizedQuota(
        {
          id: `rate-${windowKey}`,
          label: RATE_WINDOW_LABELS[windowKey] ?? `${rate.window} limit`,
          scope: "feature",
        },
        rate.used,
        rate.limit,
        "USD",
        {
          ...(minutes === undefined
            ? {}
            : { cadence: "rolling" as const, durationMs: minutes * 60 * 1_000 }),
          ...(resetsAt === undefined ? {} : { resetsAt }),
        },
      );
      if (metric) metrics.push(metric);
    }

    if (metrics.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const planLabel = parsed.data.planName?.trim();
    return {
      ok: true,
      snapshot: {
        providerKind: "sub2api",
        ...(planLabel ? { planLabel } : {}),
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const sub2apiAdapter = {
  id: "sub2api",
  collect: collectSub2Api,
} satisfies ProviderCollector<"sub2api">;
