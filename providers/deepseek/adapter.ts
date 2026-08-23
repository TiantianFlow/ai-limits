import type { BalanceMetric, ProviderHealth } from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  deepSeekBalanceResponseSchema,
  type DeepSeekBalanceInfo,
} from "./schema";

const BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance";

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

// Mirrors the selection in the upstream reference implementation:
// prefer a funded USD row, then any funded row, then USD, then the first row.
function selectBalance(
  balances: DeepSeekBalanceInfo[],
): DeepSeekBalanceInfo | undefined {
  return (
    balances.find(
      (info) => info.currency === "USD" && info.total_balance > 0,
    ) ??
    balances.find((info) => info.total_balance > 0) ??
    balances.find((info) => info.currency === "USD") ??
    balances[0]
  );
}

function normalizeBalance(
  info: DeepSeekBalanceInfo,
): BalanceMetric | undefined {
  if (!Number.isFinite(info.total_balance) || info.total_balance < 0) {
    return undefined;
  }

  return {
    type: "balance",
    id: "balance",
    label: "Balance",
    scope: "general",
    value: info.total_balance,
    unit: info.currency,
  };
}

async function collectDeepSeek({
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

    const parsed = deepSeekBalanceResponseSchema.safeParse(
      await parseJson(response),
    );
    if (!parsed.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const selected = selectBalance(parsed.data.balance_infos);
    const metric = selected === undefined ? undefined : normalizeBalance(selected);
    if (metric === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "deepseek",
        source: "api-key",
        fetchedAt: now,
        metrics: [metric],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const deepSeekAdapter: ProviderCollector<"deepseek"> = {
  id: "deepseek",
  collect: collectDeepSeek,
};
