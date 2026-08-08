import type { ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  kimiCodingUsageSchema,
  kimiUsageResponseSchema,
  type KimiUsageDetail,
  type KimiUsageLimit,
} from "./schema";

const KIMI_ORIGIN = "https://www.kimi.com/*";
const KIMI_URL = "https://www.kimi.com/";
const USAGES_ENDPOINT =
  "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages";
const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function healthForStatus(status: number): ProviderHealth {
  if (status === 401) {
    return { kind: "signed_out" };
  }

  if (status === 429 || status >= 500) {
    return { kind: "temporary_error" };
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

async function collectKimi({
  fetch: injectedFetch,
  getCookie,
  getAccessToken,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const cookie = await getCookie?.({ url: KIMI_URL, name: "kimi-auth" });
    const accessToken = cookie?.value.trim() || (await getAccessToken?.())?.trim();
    if (!accessToken) {
      return {
        ok: false,
        health: {
          kind: "temporary_error",
          message: "Open Kimi in a tab, make sure you're signed in, then try again.",
        },
      };
    }

    const response = await injectedFetch(USAGES_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "X-Language": "en-US",
        "X-Msh-Platform": "web",
      },
      body: JSON.stringify({ scope: ["FEATURE_CODING"] }),
      signal,
    });
    if (!response.ok) {
      return { ok: false, health: healthForStatus(response.status) };
    }

    const envelope = kimiUsageResponseSchema.safeParse(await parseJson(response));
    if (!envelope.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const codingRecords = envelope.data.usages.filter(
      (usage): usage is { scope: "FEATURE_CODING" } =>
        typeof usage === "object" &&
        usage !== null &&
        "scope" in usage &&
        usage.scope === "FEATURE_CODING",
    );
    if (codingRecords.length !== 1) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const coding = kimiCodingUsageSchema.safeParse(codingRecords[0]);
    if (!coding.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const weekly = normalizeWindow(coding.data.detail, {
      id: "weekly-coding",
      label: "Weekly coding",
    }, 7 * DAY_MS);
    if (!weekly) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const fiveHourLimits = coding.data.limits.filter(
      (limit) =>
        limit.window.duration === 300 &&
        limit.window.timeUnit === "TIME_UNIT_MINUTE" &&
        durationMs(limit) === 5 * HOUR_MS,
    );
    if (fiveHourLimits.length > 1) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const fiveHour = fiveHourLimits[0]
      ? normalizeWindow(fiveHourLimits[0].detail, {
          id: "five-hour-coding",
          label: "5-hour coding",
        }, 5 * HOUR_MS)
      : undefined;
    if (fiveHourLimits.length === 1 && !fiveHour) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerId: "kimi",
        source: "web-session",
        fetchedAt: now,
        windows: [weekly, ...(fiveHour ? [fiveHour] : [])],
        credits: [],
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
