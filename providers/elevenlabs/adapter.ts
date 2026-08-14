import type { MetricCycle, ProviderHealth, QuotaMetric } from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  elevenLabsSubscriptionSchema,
  type ElevenLabsSubscription,
} from "./schema";

const SUBSCRIPTION_ENDPOINT =
  "https://api.elevenlabs.io/v1/user/subscription";

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401) {
    return { kind: "credential_invalid" };
  }

  if (response.status === 403) {
    return { kind: "credential_scope_required" };
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

function unixMilliseconds(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const timestamp = value * 1_000;
  return Number.isFinite(timestamp) &&
    timestamp > 0 &&
    Number.isFinite(new Date(timestamp).getTime())
    ? timestamp
    : undefined;
}

function previousCalendarBoundary(
  resetsAt: number,
  refreshPeriod: string | null | undefined,
): number | undefined {
  if (refreshPeriod !== "monthly_period" && refreshPeriod !== "annual_period") {
    return undefined;
  }

  const reset = new Date(resetsAt);
  const resetYear = reset.getUTCFullYear();
  const resetMonth = reset.getUTCMonth();
  const targetYear =
    refreshPeriod === "annual_period"
      ? resetYear - 1
      : resetMonth === 0
        ? resetYear - 1
        : resetYear;
  const targetMonth =
    refreshPeriod === "annual_period"
      ? resetMonth
      : resetMonth === 0
        ? 11
        : resetMonth - 1;
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

  return Number.isFinite(boundary) && boundary > 0 && boundary < resetsAt
    ? boundary
    : undefined;
}

function creditCycle(
  subscription: ElevenLabsSubscription,
  now: number,
): MetricCycle {
  const resetsAt = unixMilliseconds(
    subscription.next_character_count_reset_unix,
  );
  if (resetsAt === undefined || !Number.isFinite(now) || resetsAt <= now) {
    return {};
  }

  const explicitStartedAt = unixMilliseconds(
    subscription.last_character_count_reset_unix,
  );
  let startedAt: number | undefined;
  if (explicitStartedAt !== undefined && explicitStartedAt < resetsAt) {
    if (explicitStartedAt > now) {
      return {};
    }
    startedAt = explicitStartedAt;
  } else {
    startedAt = previousCalendarBoundary(
      resetsAt,
      subscription.character_refresh_period,
    );
  }

  if (startedAt === undefined) {
    return { resetsAt };
  }

  return startedAt <= now
    ? { startedAt, resetsAt, durationMs: resetsAt - startedAt }
    : {};
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

function normalizeQuotas(
  subscription: ElevenLabsSubscription,
  now: number,
): QuotaMetric[] {
  return [
    normalizedQuota(
      {
        id: "monthly-credits",
        label: "Monthly credits",
        scope: "product",
      },
      subscription.character_count,
      subscription.character_limit,
      "credits",
      { cadence: "calendar", ...creditCycle(subscription, now) },
    ),
    normalizedQuota(
      { id: "voice-slots", label: "Voice slots", scope: "feature" },
      subscription.voice_slots_used,
      subscription.voice_limit,
      "voices",
    ),
    normalizedQuota(
      {
        id: "professional-voice-slots",
        label: "Professional voice slots",
        scope: "feature",
      },
      subscription.professional_voice_slots_used_in_workspace,
      subscription.professional_voice_limit,
      "voices",
    ),
    normalizedQuota(
      {
        id: "voice-add-edits",
        label: "Voice add/edits",
        scope: "feature",
      },
      subscription.voice_add_edit_counter,
      subscription.max_voice_add_edits,
      "actions",
    ),
  ].filter((metric): metric is QuotaMetric => metric !== undefined);
}

async function collectElevenLabs({
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

  try {
    const response = await fetch(SUBSCRIPTION_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "xi-api-key": credential.value.trim(),
      },
      signal,
    });
    if (!response.ok) {
      return { ok: false, health: healthForResponse(response, now) };
    }

    const parsed = elevenLabsSubscriptionSchema.safeParse(
      await parseJson(response),
    );
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metrics = normalizeQuotas(parsed.data, now);
    if (metrics.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "elevenlabs",
        planLabel: parsed.data.tier,
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const elevenLabsAdapter: ProviderAdapter<"elevenlabs"> = {
  id: "elevenlabs",
  collect: collectElevenLabs,
};
