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
import {
  llmProxyQuotaGroupSchema,
  llmProxyQuotaStatsSchema,
  type LlmProxyQuotaGroup,
  type LlmProxyQuotaStats,
} from "./schema";

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

function quotaGroupsFrom(value: unknown): LlmProxyQuotaGroup[] {
  if (value === undefined || value === null) return [];
  const asArray = llmProxyQuotaGroupSchema.array().safeParse(value);
  if (asArray.success) return asArray.data;
  const asRecord = zRecord(value);
  return asRecord ?? [];
}

function zRecord(value: unknown): LlmProxyQuotaGroup[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const groups: LlmProxyQuotaGroup[] = [];
  for (const item of Object.values(value)) {
    const parsed = llmProxyQuotaGroupSchema.safeParse(item);
    if (!parsed.success) return undefined;
    groups.push(parsed.data);
  }
  return groups;
}

function tokenTotal(
  tokens: LlmProxyQuotaStats["providers"][string]["tokens"],
): number {
  return (
    (tokens?.input_cached ?? 0) +
    (tokens?.input_uncached ?? 0) +
    (tokens?.output ?? 0)
  );
}

function isoMilliseconds(value: string | null | undefined): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function remainingQuota(
  remainingPercent: number,
  resetsAt: number | undefined,
): QuotaMetric {
  const usedRatio = Math.min(1, Math.max(0, 1 - remainingPercent / 100));
  return {
    type: "quota",
    id: "remaining-quota",
    label: "Remaining quota",
    scope: "product",
    usedRatio,
    ...(resetsAt === undefined ? {} : { cycle: { resetsAt } }),
  };
}

function usageCounter(
  id: string,
  label: string,
  value: number,
  unit: string,
): CounterMetric {
  return {
    type: "counter",
    id,
    label,
    scope: "product",
    semantic: "consumed",
    value,
    unit,
  };
}

async function collectLlmProxy({
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
    const response = await fetch(`${baseUrl}/v1/quota-stats`, {
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

    const parsed = llmProxyQuotaStatsSchema.safeParse(await parseJson(response));
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const providers = Object.values(parsed.data.providers);
    const groups = providers.flatMap((stats) => quotaGroupsFrom(stats.quota_groups));
    const remainingPercents = groups.flatMap((group) =>
      typeof group.remaining_percent === "number" ? [group.remaining_percent] : [],
    );
    const minRemaining =
      remainingPercents.length === 0 ? undefined : Math.min(...remainingPercents);
    const nextResetAt = groups
      .flatMap((group) => {
        const reset = isoMilliseconds(group.reset_time);
        return reset !== undefined && reset > now ? [reset] : [];
      })
      .sort((left, right) => left - right)[0];

    const computedRequests = providers.reduce(
      (sum, stats) => sum + (stats.total_requests ?? 0),
      0,
    );
    const computedTokens = providers.reduce(
      (sum, stats) => sum + tokenTotal(stats.tokens),
      0,
    );
    const totalRequests = parsed.data.summary?.total_requests ?? computedRequests;
    const totalTokens = parsed.data.summary?.total_tokens ?? computedTokens;

    const metrics: UsageMetric[] = [];
    if (minRemaining !== undefined) {
      metrics.push(remainingQuota(minRemaining, nextResetAt));
    } else {
      metrics.push(
        usageCounter("total-requests", "Total requests", totalRequests, "requests"),
        usageCounter("total-tokens", "Total tokens", totalTokens, "tokens"),
      );
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "llmProxy",
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const llmProxyAdapter = {
  id: "llmProxy",
  collect: collectLlmProxy,
} satisfies ProviderCollector<"llmProxy">;
