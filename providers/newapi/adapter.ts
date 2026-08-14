import type { ProviderHealth } from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type { CollectionContext, CollectionResult, ProviderCollector } from "../types";
import { newApiStatusSchema, newApiTokenUsageSchema } from "./schema";
import { normalizeNewApiBaseUrl } from "./url";

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

function healthForStatusResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 429 || response.status >= 500) {
    const retryAt = retryAtFromResponse(response, now);
    return {
      kind: "temporary_error",
      ...(retryAt === undefined ? {} : { retryAt }),
    };
  }
  return { kind: "provider_changed" };
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function totalsAreConsistent(granted: number, used: number, available: number): boolean {
  const tolerance = Math.max(1e-6, Math.abs(granted) * 1e-9);
  return Math.abs(granted - used - available) <= tolerance;
}

async function collectNewApi({
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
    const statusResponse = await fetch(`${baseUrl}/api/status`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!statusResponse.ok) {
      return { ok: false, health: healthForStatusResponse(statusResponse, now) };
    }
    const status = newApiStatusSchema.safeParse(await json(statusResponse));
    if (!status.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const usageResponse = await fetch(`${baseUrl}/api/usage/token/`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!usageResponse.ok) {
      return { ok: false, health: healthForResponse(usageResponse, now) };
    }
    const usage = newApiTokenUsageSchema.safeParse(await json(usageResponse));
    if (!usage.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const value = usage.data.data;
    if (
      !value.unlimited_quota &&
      (!totalsAreConsistent(
        value.total_granted,
        value.total_used,
        value.total_available,
      ) || value.total_granted <= 0)
    ) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "newapi",
        accountLabel: status.data.data.system_name,
        planLabel: value.name,
        source: "api-key",
        fetchedAt: now,
        metrics: value.unlimited_quota
          ? [
              {
                type: "counter",
                id: "relay-key-usage",
                label: "API key usage",
                scope: "feature",
                semantic: "consumed",
                unit: "quota units",
                value: value.total_used,
              },
            ]
          : [
              {
                type: "quota",
                id: "relay-key-quota",
                label: "API key quota",
                scope: "feature",
                usedRatio: value.total_used / value.total_granted,
                used: value.total_used,
                limit: value.total_granted,
                unit: "quota units",
              },
            ],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const newApiAdapter = {
  id: "newapi",
  collect: collectNewApi,
} satisfies ProviderCollector<"newapi">;
