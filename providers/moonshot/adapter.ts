import type { BalanceMetric, ProviderHealth } from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { moonshotBalanceResponseSchema } from "./schema";

// Region is a user choice in CodexBar (MoonshotRegion.swift); this port is
// hardcoded to the international host only.
const BALANCE_ENDPOINT = "https://api.moonshot.ai/v1/users/me/balance";

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

function normalizeBalance(available: number): BalanceMetric | undefined {
  if (!Number.isFinite(available)) {
    return undefined;
  }

  return {
    type: "balance",
    id: "balance",
    label: "Balance",
    scope: "general",
    value: available,
    unit: "USD",
  };
}

async function collectMoonshot({
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
    const response = await fetch(BALANCE_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential.value.trim()}`,
      },
      signal,
    });
    if (!response.ok) {
      return { ok: false, health: healthForResponse(response, now) };
    }

    const parsed = moonshotBalanceResponseSchema.safeParse(
      await parseJson(response),
    );
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    // CodexBar MoonshotUsageFetcher.parseSummary treats status !== true or a
    // non-zero code as an API error, not a parse failure.
    if (parsed.data.status !== true || parsed.data.code !== 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metric = normalizeBalance(parsed.data.data.available_balance);
    if (metric === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "moonshot",
        source: "api-key",
        fetchedAt: now,
        metrics: [metric],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const moonshotAdapter: ProviderCollector<"moonshot"> = {
  id: "moonshot",
  collect: collectMoonshot,
};
