import type { ProviderHealth, QuotaMetric } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { retryAtFromResponse } from "../retry-after";
import {
  kimiCodingUsageSchema,
  kimiEnabledZeroRateLimitStatSchema,
  kimiRatioSchema,
  kimiRateLimitStatSchema,
  kimiSubscriptionBalanceSchema,
  kimiSubscriptionSchema,
  kimiSubscriptionStatsSchema,
  kimiUsageResponseSchema,
  type KimiUsageDetail,
  type KimiUsageLimit,
} from "./schema";

const KIMI_URL = "https://www.kimi.com/";
const SUBSCRIPTION_STATS_ENDPOINT =
  "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats";
const SUBSCRIPTION_ENDPOINT =
  "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription";
const LEGACY_USAGES_ENDPOINT =
  "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages";
const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SEGMENT_SUM_TOLERANCE = 1e-6;
type KimiUsageEndpoint = "current" | "legacy";
const retryEndpoints = new WeakMap<object, KimiUsageEndpoint>();

function sessionRequired(endpoint: KimiUsageEndpoint): CollectionResult {
  const result: CollectionResult = {
    ok: false,
    deferred: { reason: "session_required" },
  };
  retryEndpoints.set(result, endpoint);
  return result;
}

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401) {
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

function durationMs(limit: KimiUsageLimit): number | undefined {
  const value = limit.window.duration;
  const unitMs =
    limit.window.timeUnit === "TIME_UNIT_MINUTE"
      ? MINUTE_MS
      : limit.window.timeUnit === "TIME_UNIT_HOUR"
        ? HOUR_MS
        : limit.window.timeUnit === "TIME_UNIT_DAY"
          ? DAY_MS
          : undefined;
  const duration = unitMs === undefined ? undefined : value * unitMs;

  return duration !== undefined && Number.isSafeInteger(duration) && duration > 0
    ? duration
    : undefined;
}

function normalizedAmounts(
  detail: KimiUsageDetail,
): { limit: number; used: number } | undefined {
  const limit = Number(detail.limit);
  const suppliedUsed = detail.used === undefined ? undefined : Number(detail.used);
  const remaining =
    detail.remaining === undefined ? undefined : Number(detail.remaining);

  if (!Number.isFinite(limit) || limit <= 0 || (suppliedUsed === undefined && remaining === undefined)) {
    return undefined;
  }

  const used = suppliedUsed ?? limit - (remaining as number);
  if (!Number.isFinite(used) || used < 0 || used > limit) {
    return undefined;
  }

  if (
    remaining !== undefined &&
    (!Number.isFinite(remaining) || remaining < 0 || remaining > limit || used + remaining !== limit)
  ) {
    return undefined;
  }

  return { limit, used };
}

function normalizeWindow(
  detail: KimiUsageDetail,
  identity: Pick<QuotaMetric, "id" | "label">,
  duration: number,
): QuotaMetric | undefined {
  const amounts = normalizedAmounts(detail);
  const resetsAt = Date.parse(detail.resetTime);
  if (!amounts || duration === undefined || !Number.isFinite(resetsAt) || resetsAt <= 0) {
    return undefined;
  }

  return {
    ...identity,
    type: "quota",
    scope: "feature",
    usedRatio: amounts.used / amounts.limit,
    used: amounts.used,
    limit: amounts.limit,
    cycle: { cadence: "rolling", resetsAt, durationMs: duration },
  };
}

function optionalTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
}

function previousCalendarMonth(timestamp: number): number | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const reset = new Date(timestamp);
  const resetYear = reset.getUTCFullYear();
  const resetMonth = reset.getUTCMonth();
  const targetYear = resetMonth === 0 ? resetYear - 1 : resetYear;
  const targetMonth = resetMonth === 0 ? 11 : resetMonth - 1;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(reset.getUTCDate(), lastTargetDay);
  const boundary = Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    reset.getUTCHours(),
    reset.getUTCMinutes(),
    reset.getUTCSeconds(),
    reset.getUTCMilliseconds(),
  );

  return Number.isFinite(boundary) && boundary > 0 ? boundary : undefined;
}

function monthlySegments(
  totalUsedRatio: number,
  codeUsedRatio: unknown,
): QuotaMetric["segments"] | undefined {
  const code = kimiRatioSchema.safeParse(codeUsedRatio);
  if (!code.success || code.data > totalUsedRatio) {
    return undefined;
  }

  const segments = [
    { id: "work", label: "Work", usedRatio: totalUsedRatio - code.data },
    { id: "code", label: "Code", usedRatio: code.data },
  ];
  const sum = segments.reduce((total, segment) => total + segment.usedRatio, 0);

  return Math.abs(sum - totalUsedRatio) <= SEGMENT_SUM_TOLERANCE
    ? segments
    : undefined;
}

function normalizeCurrentStats(body: unknown): QuotaMetric[] | undefined {
  const envelope = kimiSubscriptionStatsSchema.safeParse(body);
  if (!envelope.success) {
    return undefined;
  }

  const metrics: QuotaMetric[] = [];
  const balance = kimiSubscriptionBalanceSchema.safeParse(
    envelope.data.subscriptionBalance,
  );
  if (balance.success) {
    const resetsAt = optionalTimestamp(balance.data.expireTime);
    const startedAt =
      resetsAt === undefined ? undefined : previousCalendarMonth(resetsAt);
    const segments = monthlySegments(
      balance.data.amountUsedRatio,
      balance.data.kimiCodeUsedRatio,
    );
    metrics.push({
      type: "quota",
      id: "monthly-total",
      label: "Total usage",
      scope: "general",
      usedRatio: balance.data.amountUsedRatio,
      ...(startedAt === undefined && resetsAt === undefined
        ? {}
        : {
            cycle: {
              cadence: "calendar",
              ...(startedAt === undefined ? {} : { startedAt }),
              ...(resetsAt === undefined ? {} : { resetsAt }),
            },
          }),
      ...(segments === undefined ? {} : { segments }),
    });
  }

  const rateLimits = [
    {
      value: envelope.data.ratelimitCode5h,
      id: "five-hour-coding",
      label: "5-hour usage",
      durationMs: 5 * HOUR_MS,
      acceptsOmittedZero: true,
    },
    {
      value: envelope.data.ratelimitCode7d,
      id: "weekly-coding",
      label: "7-day usage",
      durationMs: 7 * DAY_MS,
      acceptsOmittedZero: true,
    },
  ] as const;

  for (const rateLimit of rateLimits) {
    const parsed = kimiRateLimitStatSchema.safeParse(rateLimit.value);
    let usedRatio: number;
    let resetTime: string | undefined;
    if (parsed.success && parsed.data.enabled !== false) {
      usedRatio = parsed.data.ratio;
      resetTime = parsed.data.resetTime;
    } else if (rateLimit.acceptsOmittedZero) {
      const enabledZero = kimiEnabledZeroRateLimitStatSchema.safeParse(
        rateLimit.value,
      );
      if (!enabledZero.success) {
        continue;
      }
      if (optionalTimestamp(enabledZero.data.resetTime) === undefined) {
        continue;
      }
      usedRatio = 0;
      resetTime = enabledZero.data.resetTime;
    } else {
      continue;
    }

    metrics.push({
      type: "quota",
      id: rateLimit.id,
      label: rateLimit.label,
      scope: "feature",
      usedRatio,
      cycle: {
        cadence: "rolling",
        resetsAt: optionalTimestamp(resetTime),
        durationMs: rateLimit.durationMs,
      },
    });
  }

  return metrics;
}

function normalizeLegacyUsage(body: unknown): QuotaMetric[] | undefined {
  const envelope = kimiUsageResponseSchema.safeParse(body);
  if (!envelope.success) {
    return undefined;
  }

  const codingRecords = envelope.data.usages.filter(
    (usage): usage is { scope: "FEATURE_CODING" } =>
      typeof usage === "object" &&
      usage !== null &&
      "scope" in usage &&
      usage.scope === "FEATURE_CODING",
  );
  if (codingRecords.length !== 1) {
    return undefined;
  }

  const coding = kimiCodingUsageSchema.safeParse(codingRecords[0]);
  if (!coding.success) {
    return undefined;
  }

  const weekly = normalizeWindow(
    coding.data.detail,
    { id: "weekly-coding", label: "7-day usage" },
    7 * DAY_MS,
  );
  if (!weekly) {
    return undefined;
  }

  const fiveHourLimits = coding.data.limits.filter(
    (limit) =>
      limit.window.duration === 300 &&
      limit.window.timeUnit === "TIME_UNIT_MINUTE" &&
      durationMs(limit) === 5 * HOUR_MS,
  );
  if (fiveHourLimits.length > 1) {
    return undefined;
  }

  const fiveHour = fiveHourLimits[0]
    ? normalizeWindow(
        fiveHourLimits[0].detail,
        { id: "five-hour-coding", label: "5-hour usage" },
        5 * HOUR_MS,
      )
    : undefined;
  if (fiveHourLimits.length === 1 && !fiveHour) {
    return undefined;
  }

  return [weekly, ...(fiveHour ? [fiveHour] : [])];
}

function kimiRequest(
  injectedFetch: typeof globalThis.fetch,
  endpoint: string,
  accessToken: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  return injectedFetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "X-Language": "en-US",
      "X-Msh-Platform": "web",
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function collectKimi({
  accessToken,
  fetch: injectedFetch,
  now,
  signal,
}: CollectionContext,
  initialEndpoint: KimiUsageEndpoint = "current",
): Promise<CollectionResult> {
  const token = accessToken?.trim();
  if (!token) {
    return sessionRequired(initialEndpoint);
  }

  try {
    let response = await kimiRequest(
      injectedFetch,
      initialEndpoint === "legacy"
        ? LEGACY_USAGES_ENDPOINT
        : SUBSCRIPTION_STATS_ENDPOINT,
      token,
      initialEndpoint === "legacy" ? { scope: ["FEATURE_CODING"] } : {},
      signal,
    );
    if (response.status === 401) {
      return sessionRequired(initialEndpoint);
    }

    let legacy = initialEndpoint === "legacy";
    if (!legacy && (response.status === 404 || response.status === 405)) {
      legacy = true;
      response = await kimiRequest(
        injectedFetch,
        LEGACY_USAGES_ENDPOINT,
        token,
        { scope: ["FEATURE_CODING"] },
        signal,
      );
      if (response.status === 401) {
        return sessionRequired("legacy");
      }
    }
    if (!response.ok) {
      return { ok: false, health: healthForResponse(response, now) };
    }

    const body = await parseJson(response);
    const metrics = legacy
      ? normalizeLegacyUsage(body)
      : normalizeCurrentStats(body);
    if (!metrics?.length) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    let planLabel: string | undefined;
    if (!legacy) {
      try {
        const subscriptionResponse = await kimiRequest(
          injectedFetch,
          SUBSCRIPTION_ENDPOINT,
          token,
          {},
          signal,
        );
        if (subscriptionResponse.ok) {
          const subscriptionBody = await parseJson(subscriptionResponse);
          const subscription = kimiSubscriptionSchema.safeParse(subscriptionBody);
          if (subscription.success) {
            planLabel = subscription.data.subscription.goods.title;
          }
        }
      } catch {
        // Subscription metadata is optional and must not erase valid usage.
      }
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "kimi",
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
        ...(planLabel === undefined ? {} : { planLabel }),
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export function retryKimiAdapterAfterChangedToken(
  result: CollectionResult,
  context: CollectionContext,
): Promise<CollectionResult> {
  return collectKimi(context, retryEndpoints.get(result) ?? "current");
}

export const kimiAdapter: ProviderCollector<"kimi"> = {
  id: "kimi",
  collect: collectKimi,
};
