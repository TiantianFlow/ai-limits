import {
  KIMI_RECOVERY_GUIDANCE,
  type ProviderHealth,
  type QuotaWindow,
} from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import { retryAtFromResponse } from "../retry-after";
import {
  kimiCodingUsageSchema,
  kimiEnabledZeroRateLimitStatSchema,
  kimiRateLimitStatSchema,
  kimiSubscriptionBalanceSchema,
  kimiSubscriptionSchema,
  kimiSubscriptionStatsSchema,
  kimiUsageResponseSchema,
  type KimiUsageDetail,
  type KimiUsageLimit,
} from "./schema";

const KIMI_ORIGIN = "https://www.kimi.com/*";
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
const SESSION_REQUIRED = Symbol("kimi-session-required");

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
  identity: Pick<QuotaWindow, "id" | "label">,
  duration: number,
): QuotaWindow | undefined {
  const amounts = normalizedAmounts(detail);
  const resetsAt = Date.parse(detail.resetTime);
  if (!amounts || duration === undefined || !Number.isFinite(resetsAt) || resetsAt <= 0) {
    return undefined;
  }

  return {
    ...identity,
    kind: "feature",
    usedRatio: amounts.used / amounts.limit,
    used: amounts.used,
    limit: amounts.limit,
    resetsAt,
    durationMs: duration,
    sourceSemantics: "used",
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

function normalizeCurrentStats(body: unknown): QuotaWindow[] | undefined {
  const envelope = kimiSubscriptionStatsSchema.safeParse(body);
  if (!envelope.success) {
    return undefined;
  }

  const windows: QuotaWindow[] = [];
  const balance = kimiSubscriptionBalanceSchema.safeParse(
    envelope.data.subscriptionBalance,
  );
  if (balance.success) {
    const resetsAt = optionalTimestamp(balance.data.expireTime);
    const startedAt =
      resetsAt === undefined ? undefined : previousCalendarMonth(resetsAt);
    windows.push({
      id: "monthly-total",
      label: "Monthly total",
      kind: "calendar",
      usedRatio: balance.data.amountUsedRatio,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
      sourceSemantics: "used",
    });
  }

  const rateLimits = [
    {
      value: envelope.data.ratelimitCode5h,
      id: "five-hour-coding",
      label: "5-hour coding",
      durationMs: 5 * HOUR_MS,
      acceptsOmittedZero: true,
    },
    {
      value: envelope.data.ratelimitCode7d,
      id: "weekly-coding",
      label: "Weekly coding",
      durationMs: 7 * DAY_MS,
      acceptsOmittedZero: false,
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

    windows.push({
      id: rateLimit.id,
      label: rateLimit.label,
      kind: "feature",
      usedRatio,
      resetsAt: optionalTimestamp(resetTime),
      durationMs: rateLimit.durationMs,
      sourceSemantics: "used",
    });
  }

  return windows;
}

function normalizeLegacyUsage(body: unknown): QuotaWindow[] | undefined {
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
    { id: "weekly-coding", label: "Weekly coding" },
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
        { id: "five-hour-coding", label: "5-hour coding" },
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
  fetch: injectedFetch,
  getCookie,
  interaction,
  kimiSessionResolver,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const findAvailableAccessToken = async (): Promise<string | undefined> => {
      try {
        return (
          await kimiSessionResolver?.findAvailableAccessToken()
        )?.trim();
      } catch {
        return undefined;
      }
    };
    const cookie = await getCookie?.({ url: KIMI_URL, name: "kimi-auth" });
    const cookieToken = cookie?.value.trim();
    let recoveryAttempted = false;
    let initialAccessToken = cookieToken;
    if (!initialAccessToken) {
      initialAccessToken = await findAvailableAccessToken();
    }

    if (!initialAccessToken) {
      if (interaction !== "allowed") {
        return {
          ok: false,
          deferred: { reason: "session_required" },
        };
      }

      let recoveredToken: string | undefined;
      recoveryAttempted = true;
      try {
        recoveredToken = (
          await kimiSessionResolver?.recoverAccessToken(undefined)
        )?.trim();
      } catch {
        // Interactive recovery failures are reduced to approved fallback copy.
      }
      if (recoveredToken) {
        initialAccessToken = recoveredToken;
      }
    }

    if (!initialAccessToken) {
      return {
        ok: false,
        health: {
          kind: "temporary_error",
          message: KIMI_RECOVERY_GUIDANCE,
        },
      };
    }
    let activeAccessToken = initialAccessToken;
    let pageTokenRereadAfterUnauthorized = false;

    const requestWithCredentialPolicy = async (
      endpoint: string,
      body: unknown,
    ): Promise<Response | typeof SESSION_REQUIRED> => {
      let endpointResponse = await kimiRequest(
        injectedFetch,
        endpoint,
        activeAccessToken,
        body,
        signal,
      );

      if (
        endpointResponse.status === 401 &&
        !pageTokenRereadAfterUnauthorized
      ) {
        pageTokenRereadAfterUnauthorized = true;
        const pageToken = await findAvailableAccessToken();
        if (pageToken && pageToken !== activeAccessToken) {
          activeAccessToken = pageToken;
          endpointResponse = await kimiRequest(
            injectedFetch,
            endpoint,
            activeAccessToken,
            body,
            signal,
          );
        }
      }

      if (endpointResponse.status !== 401) return endpointResponse;
      if (interaction !== "allowed") return SESSION_REQUIRED;

      if (!recoveryAttempted) {
        recoveryAttempted = true;
        let recoveredToken: string | undefined;
        try {
          recoveredToken = (
            await kimiSessionResolver?.recoverAccessToken(activeAccessToken)
          )?.trim();
        } catch {
          // Interactive recovery failures are reduced to approved fallback copy.
        }
        if (recoveredToken && recoveredToken !== activeAccessToken) {
          activeAccessToken = recoveredToken;
          endpointResponse = await kimiRequest(
            injectedFetch,
            endpoint,
            activeAccessToken,
            body,
            signal,
          );
        }
      }

      return endpointResponse;
    };

    let response = await requestWithCredentialPolicy(
      SUBSCRIPTION_STATS_ENDPOINT,
      {},
    );
    if (response === SESSION_REQUIRED) {
      return {
        ok: false,
        deferred: { reason: "session_required" },
      };
    }

    let legacy = false;
    if (response.status === 404 || response.status === 405) {
      legacy = true;
      response = await requestWithCredentialPolicy(
        LEGACY_USAGES_ENDPOINT,
        { scope: ["FEATURE_CODING"] },
      );
      if (response === SESSION_REQUIRED) {
        return {
          ok: false,
          deferred: { reason: "session_required" },
        };
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        health:
          response.status === 401
            ? {
                kind: "temporary_error",
                message: KIMI_RECOVERY_GUIDANCE,
              }
            : healthForResponse(response, now),
      };
    }

    const body = await parseJson(response);
    const windows = legacy
      ? normalizeLegacyUsage(body)
      : normalizeCurrentStats(body);
    if (!windows?.length) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    let planLabel: string | undefined;
    if (!legacy) {
      try {
        const subscriptionResponse = await kimiRequest(
          injectedFetch,
          SUBSCRIPTION_ENDPOINT,
          activeAccessToken,
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
        providerId: "kimi",
        source: "web-session",
        fetchedAt: now,
        windows,
        credits: [],
        ...(planLabel === undefined ? {} : { planLabel }),
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  capabilities: { browserSession: true },
  optionalOrigins: [KIMI_ORIGIN],
  optionalPermissions: ["cookies", "scripting"],
  collect: collectKimi,
};
