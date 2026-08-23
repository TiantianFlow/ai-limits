import type {
  CounterMetric,
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
import { liteLlmKeyInfoSchema, type LiteLlmKeyInfo } from "./schema";

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

function trimmed(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function spendCounter(
  id: string,
  label: string,
  spend: number,
): CounterMetric {
  return {
    type: "counter",
    id,
    label,
    scope: "product",
    semantic: "spent",
    value: spend,
    unit: "USD",
  };
}

function spendQuota(
  id: string,
  label: string,
  spend: number,
  budget: number,
): QuotaMetric | undefined {
  if (budget <= 0 || spend < 0 || spend > budget) return undefined;
  return {
    type: "quota",
    id,
    label,
    scope: "product",
    usedRatio: spend / budget,
    used: spend,
    limit: budget,
    unit: "USD",
  };
}

function metricsFromKeyInfo(info: LiteLlmKeyInfo): UsageMetric[] {
  const spend = info.spend ?? 0;
  const budget = info.max_budget ?? undefined;
  const teamOnly = trimmed(info.user_id) === undefined && trimmed(info.team_id) !== undefined;
  const id = teamOnly ? "team-spend" : "key-spend";
  const quotaId = teamOnly ? "team-budget" : "key-budget";
  const label = teamOnly ? "Team spend" : "Key spend";
  const quotaLabel = teamOnly ? "Team budget" : "Key budget";

  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    const quota = spendQuota(quotaId, quotaLabel, spend, budget);
    if (quota) return [quota];
  }

  if (!Number.isFinite(spend) || spend < 0) return [];
  return [spendCounter(id, label, spend)];
}

async function collectLiteLlm({
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
    const response = await fetch(`${baseUrl}/key/info`, {
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

    const parsed = liteLlmKeyInfoSchema.safeParse(await parseJson(response));
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metrics = metricsFromKeyInfo(parsed.data.info);
    if (metrics.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const accountLabel = trimmed(parsed.data.info.key_name);
    return {
      ok: true,
      snapshot: {
        providerKind: "litellm",
        ...(accountLabel === undefined ? {} : { accountLabel }),
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const liteLlmAdapter = {
  id: "litellm",
  collect: collectLiteLlm,
} satisfies ProviderCollector<"litellm">;
