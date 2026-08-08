import type { ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import { kimiUsageResponseSchema, type KimiUsage } from "./schema";

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

function durationMs(usage: KimiUsage): number | undefined {
  const value = Number(usage.time_value);
  const unitMs =
    usage.time_unit === "TIME_UNIT_MINUTE"
      ? MINUTE_MS
      : usage.time_unit === "TIME_UNIT_HOUR"
        ? HOUR_MS
        : usage.time_unit === "TIME_UNIT_DAY"
          ? DAY_MS
          : undefined;
  const duration = unitMs === undefined ? undefined : value * unitMs;

  return duration !== undefined && Number.isSafeInteger(duration) && duration > 0
    ? duration
    : undefined;
}

function normalizedAmounts(
  usage: KimiUsage,
): { limit: number; used: number } | undefined {
  const limit = Number(usage.limit);
  const suppliedUsed = usage.used === undefined ? undefined : Number(usage.used);
  const remaining =
    usage.remaining === undefined ? undefined : Number(usage.remaining);

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
  usage: KimiUsage,
  identity: Pick<QuotaWindow, "id" | "label">,
): QuotaWindow | undefined {
  const amounts = normalizedAmounts(usage);
  const duration = durationMs(usage);
  const resetsAt = Date.parse(usage.reset_time);
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
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const cookie = await getCookie?.({ url: KIMI_URL, name: "kimi-auth" });
    if (!cookie?.value.trim()) {
      return { ok: false, health: { kind: "signed_out" } };
    }

    const response = await injectedFetch(USAGES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cookie.value}`,
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

    const parsed = kimiUsageResponseSchema.safeParse(await parseJson(response));
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const weekly = normalizeWindow(parsed.data.usage, {
      id: "weekly-coding",
      label: "Weekly coding",
    });
    if (!weekly || weekly.durationMs !== 7 * DAY_MS) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const fiveHourUsage = parsed.data.usage.nested_usage?.find(
      (usage) => durationMs(usage) === 5 * HOUR_MS,
    );
    const fiveHour = fiveHourUsage
      ? normalizeWindow(fiveHourUsage, {
          id: "five-hour-coding",
          label: "5-hour coding",
        })
      : undefined;
    if (fiveHourUsage && !fiveHour) {
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
  optionalPermissions: ["cookies"],
  collect: collectKimi,
};
