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
  openRouterCreditsResponseSchema,
  openRouterKeyResponseSchema,
  type OpenRouterKeyData,
} from "./schema";

// The upstream reference implementation defaults to
// https://openrouter.ai/api/v1 and reads GET {base}/credits, then GET
// {base}/key.
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const KEY_URL = "https://openrouter.ai/api/v1/key";

// Product client title sent as X-Title on the credits request.
const CLIENT_TITLE = "AI Limits";

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

function present(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resetWindowUsage(key: OpenRouterKeyData): number | undefined {
  // openrouter.js resetWindowUsage (lines 258-269).
  switch (key.limit_reset) {
    case "daily":
      return present(key.usage_daily);
    case "weekly":
      return present(key.usage_weekly);
    case "monthly":
      return present(key.usage_monthly);
    default:
      return undefined;
  }
}

function keyUsedForQuota(key: OpenRouterKeyData, keyLimit: number): number | undefined {
  // openrouter.js keyUsedForQuota (lines 273-283): prefer server remaining,
  // then the reset-window usage, then cumulative usage.
  const remaining = present(key.limit_remaining);
  if (remaining !== undefined) {
    return keyLimit - Math.min(keyLimit, Math.max(0, remaining));
  }
  const windowUsage = resetWindowUsage(key);
  if (windowUsage !== undefined) return windowUsage;
  return present(key.usage);
}

function keyBudgetMetric(key: OpenRouterKeyData): QuotaMetric | undefined {
  const keyLimit = present(key.limit);
  if (keyLimit === undefined || keyLimit <= 0) return undefined;
  const used = keyUsedForQuota(key, keyLimit);
  if (used === undefined || used < 0) return undefined;
  return {
    type: "quota",
    id: "key-budget",
    label: "API key budget",
    scope: "product",
    usedRatio: Math.min(1, used / keyLimit),
    used,
    limit: keyLimit,
    unit: "USD",
  };
}

function creditsBalance(totalCredits: number, totalUsage: number): BalanceMetric | undefined {
  if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
    return undefined;
  }
  const remaining = Math.max(0, totalCredits - totalUsage);
  return {
    type: "balance",
    id: "balance",
    label: "Balance",
    scope: "general",
    value: remaining,
    unit: "USD",
    ...(totalCredits > 0 ? { initialLimit: totalCredits } : {}),
  };
}

async function collectOpenRouter({
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

  const authorization = `Bearer ${credential.value.trim()}`;
  const accept = { Accept: "application/json", Authorization: authorization };

  try {
    const creditsResponse = await fetch(CREDITS_URL, {
      method: "GET",
      headers: {
        ...accept,
        "X-Title": CLIENT_TITLE,
      },
      signal,
    });
    if (!creditsResponse.ok) {
      return { ok: false, health: healthForResponse(creditsResponse, now) };
    }

    const credits = openRouterCreditsResponseSchema.safeParse(
      await parseJson(creditsResponse),
    );
    if (!credits.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const balance = creditsBalance(
      credits.data.data.total_credits,
      credits.data.data.total_usage,
    );
    if (balance === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metrics: UsageMetric[] = [balance];

    try {
      const keyResponse = await fetch(KEY_URL, {
        method: "GET",
        headers: accept,
        signal,
      });
      if (keyResponse.ok) {
        const key = openRouterKeyResponseSchema.safeParse(
          await parseJson(keyResponse),
        );
        if (key.success) {
          const quota = keyBudgetMetric(key.data.data);
          if (quota) metrics.push(quota);
        }
      }
    } catch {
      // Key enrichment is optional (openrouter.js lines 71-103).
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "openrouter",
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const openRouterAdapter: ProviderCollector<"openrouter"> = {
  id: "openrouter",
  collect: collectOpenRouter,
};
