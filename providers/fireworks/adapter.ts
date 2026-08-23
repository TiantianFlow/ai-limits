import type { CounterMetric, ProviderHealth } from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  fireworksAccountsResponseSchema,
  fireworksBillingSummarySchema,
} from "./schema";

const ACCOUNTS_ENDPOINT = "https://api.fireworks.ai/v1/accounts";
const SUMMARY_ENDPOINT_PREFIX = "https://api.fireworks.ai/v1/accounts/";
const SUMMARY_ENDPOINT_SUFFIX = "/billing/summary";

// The upstream reference implementation requests an explicit 30-day window.
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
const SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;

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

// Mirrors FireworksAccount.slug: accountId, then id, then the last path
// segment of name; only slugs inside the allowed ASCII set qualify.
function accountSlug(account: {
  name?: string | null;
  accountId?: string | null;
  id?: string | null;
}): string | undefined {
  for (const value of [account.accountId, account.id, account.name]) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const segment = trimmed.split("/").at(-1) ?? "";
    if (segment && SLUG_PATTERN.test(segment)) return segment;
  }
  return undefined;
}

function isoTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The first rated currency wins and only rows in that currency are summed;
// unrated rows are skipped, matching the upstream reference implementation.
function summarizeSpend(body: unknown): { total: number; currency: string } | undefined {
  const parsed = fireworksBillingSummarySchema.safeParse(body);
  if (!parsed.success) return undefined;

  let currency: string | undefined;
  let total = 0;
  for (const item of parsed.data.lineItems ?? []) {
    const cost = item.totalCost;
    const code = cost?.currencyCode?.trim();
    if (!cost || !code) continue;
    const units = cost.units === null || cost.units === undefined
      ? undefined
      : Number(cost.units);
    if (units === undefined || !Number.isFinite(units)) continue;
    if (cost.nanos === null || cost.nanos === undefined) continue;
    if (currency === undefined) currency = code;
    if (code !== currency) continue;
    total += units + cost.nanos / 1_000_000_000;
  }

  return currency === undefined ? undefined : { total, currency };
}

function spendCounter(total: number, currency: string): CounterMetric | undefined {
  if (!Number.isFinite(total) || total < 0) return undefined;

  return {
    type: "counter",
    id: "last-30-days-spend",
    label: "Last 30 days spend",
    scope: "general",
    semantic: "spent",
    value: total,
    unit: currency,
    cycle: { cadence: "rolling", durationMs: LOOKBACK_MS },
  };
}

async function collectFireworks({
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

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credential.value.trim()}`,
  };

  try {
    const accountsResponse = await fetch(ACCOUNTS_ENDPOINT, {
      method: "GET",
      headers,
      signal,
    });
    if (!accountsResponse.ok) {
      return { ok: false, health: healthForResponse(accountsResponse, now) };
    }

    const accounts = fireworksAccountsResponseSchema.safeParse(
      await parseJson(accountsResponse),
    );
    if (!accounts.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const slugs = [
      ...new Set(
        (accounts.data.accounts ?? [])
          .map(accountSlug)
          .filter((slug): slug is string => slug !== undefined),
      ),
    ];
    if (slugs.length !== 1) {
      // Zero or multiple accounts needs an account picker, which is out of
      // scope for this port.
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const startTime = isoTimestamp(now - LOOKBACK_MS);
    const endTime = isoTimestamp(now);
    const summaryUrl =
      `${SUMMARY_ENDPOINT_PREFIX}${slugs[0]}${SUMMARY_ENDPOINT_SUFFIX}` +
      `?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
    const summaryResponse = await fetch(summaryUrl, {
      method: "GET",
      headers,
      signal,
    });
    if (!summaryResponse.ok) {
      return { ok: false, health: healthForResponse(summaryResponse, now) };
    }

    const spend = summarizeSpend(await parseJson(summaryResponse));
    if (spend === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metric = spendCounter(spend.total, spend.currency);
    if (metric === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "fireworks",
        accountLabel: slugs[0],
        source: "api-key",
        fetchedAt: now,
        metrics: [metric],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const fireworksAdapter: ProviderCollector<"fireworks"> = {
  id: "fireworks",
  collect: collectFireworks,
};
