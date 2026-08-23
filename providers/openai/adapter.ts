import type {
  BalanceMetric,
  CounterMetric,
  ProviderHealth,
  UsageMetric,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  openAiCompletionsResponseSchema,
  openAiCostsResponseSchema,
  openAiCreditGrantsResponseSchema,
  type OpenAiCompletionsResponse,
  type OpenAiCostsResponse,
} from "./schema";

// Paths follow the upstream reference implementation.
const COSTS_PATH = "/v1/organization/costs";
const COMPLETIONS_PATH = "/v1/organization/usage/completions";
const COSTS_URL = `https://api.openai.com${COSTS_PATH}`;
const COMPLETIONS_URL = `https://api.openai.com${COMPLETIONS_PATH}`;
const CREDIT_GRANTS_URL =
  "https://api.openai.com/v1/dashboard/billing/credit_grants";

// Default history window from the upstream reference implementation.
export const OPENAI_HISTORY_DAYS = 30;
const MAX_DAILY_BUCKET_LIMIT = 31;
const MAX_PAGINATION_PAGES = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

interface DateRange {
  startTime: number;
  endTime: number;
  limit: number;
}

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

function utcDayStart(milliseconds: number): number {
  const date = new Date(milliseconds);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Use UTC day buckets with at most 31 days per request.
export function openaiDailyRanges(
  now: number,
  historyDays = OPENAI_HISTORY_DAYS,
): DateRange[] {
  const clamped = Math.max(1, Math.min(365, historyDays));
  const today = utcDayStart(now);
  let cursor = today - (clamped - 1) * DAY_MS;
  let remaining = clamped;
  const ranges: DateRange[] = [];
  while (remaining > 0) {
    const chunkDays = Math.min(MAX_DAILY_BUCKET_LIMIT, remaining);
    const end = cursor + chunkDays * DAY_MS;
    ranges.push({
      startTime: cursor / 1_000,
      endTime: end / 1_000,
      limit: chunkDays,
    });
    cursor = end;
    remaining -= chunkDays;
  }
  return ranges;
}

function organizationUrl(
  baseUrl: string,
  range: DateRange,
  groupBy: "line_item" | "model",
  page?: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("start_time", String(range.startTime));
  url.searchParams.set("end_time", String(range.endTime));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", String(range.limit));
  url.searchParams.set("group_by", groupBy);
  if (page) url.searchParams.set("page", page);
  return url.toString();
}

function cleanedPageCursor(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

type PagedFetch<T> =
  | { ok: true; pages: T[] }
  | { ok: false; health: ProviderHealth };

async function fetchPaged<T extends { data: unknown[]; has_more: boolean; next_page?: string | null }>(
  {
    fetch,
    now,
    signal,
    headers,
  }: {
    fetch: typeof globalThis.fetch;
    now: number;
    signal: AbortSignal;
    headers: Record<string, string>;
  },
  baseUrl: string,
  groupBy: "line_item" | "model",
  parse: (body: unknown) => { success: true; data: T } | { success: false },
): Promise<PagedFetch<T>> {
  const pages: T[] = [];
  for (const range of openaiDailyRanges(now)) {
    let nextPage: string | undefined;
    const seen = new Set<string>();
    let finishedRange = false;
    for (let pageCount = 0; pageCount < MAX_PAGINATION_PAGES; pageCount += 1) {
      const response = await fetch(
        organizationUrl(baseUrl, range, groupBy, nextPage),
        { method: "GET", headers, signal },
      );
      if (!response.ok) {
        return { ok: false, health: healthForResponse(response, now) };
      }
      const parsed = parse(await parseJson(response));
      if (!parsed.success) {
        return { ok: false, health: { kind: "provider_changed" } };
      }
      pages.push(parsed.data);
      if (!parsed.data.has_more) {
        finishedRange = true;
        break;
      }
      const cursor = cleanedPageCursor(parsed.data.next_page);
      if (!cursor || seen.has(cursor)) {
        return { ok: false, health: { kind: "provider_changed" } };
      }
      seen.add(cursor);
      nextPage = cursor;
    }
    if (!finishedRange) {
      return { ok: false, health: { kind: "provider_changed" } };
    }
  }
  return { ok: true, pages };
}

function summarizeUsage(
  costs: OpenAiCostsResponse[],
  completions: OpenAiCompletionsResponse[],
): { costUSD: number; requests: number; totalTokens: number } {
  let costUSD = 0;
  let requests = 0;
  let totalTokens = 0;

  for (const page of costs) {
    for (const bucket of page.data) {
      for (const result of bucket.results) {
        costUSD += result.amount?.value ?? 0;
      }
    }
  }

  for (const page of completions) {
    for (const bucket of page.data) {
      for (const result of bucket.results) {
        const input = result.input_tokens ?? 0;
        const output = result.output_tokens ?? 0;
        const audioInput = result.input_audio_tokens ?? 0;
        const audioOutput = result.output_audio_tokens ?? 0;
        requests += result.num_model_requests ?? 0;
        totalTokens += input + output + audioInput + audioOutput;
      }
    }
  }

  return { costUSD, requests, totalTokens };
}

function usageMetrics(
  totals: { costUSD: number; requests: number; totalTokens: number },
): UsageMetric[] | undefined {
  if (
    !Number.isFinite(totals.costUSD) ||
    !Number.isFinite(totals.requests) ||
    !Number.isFinite(totals.totalTokens) ||
    totals.costUSD < 0 ||
    totals.requests < 0 ||
    totals.totalTokens < 0
  ) {
    return undefined;
  }

  const cycle = { cadence: "rolling" as const, durationMs: OPENAI_HISTORY_DAYS * DAY_MS };
  const spend: CounterMetric = {
    type: "counter",
    id: "last-30-days-spend",
    label: "Last 30 days spend",
    scope: "general",
    semantic: "spent",
    value: totals.costUSD,
    unit: "USD",
    cycle,
  };
  const requestCount: CounterMetric = {
    type: "counter",
    id: "last-30-days-requests",
    label: "Last 30 days requests",
    scope: "general",
    semantic: "consumed",
    value: totals.requests,
    unit: "requests",
    cycle,
  };
  const tokens: CounterMetric = {
    type: "counter",
    id: "last-30-days-tokens",
    label: "Last 30 days tokens",
    scope: "general",
    semantic: "consumed",
    value: totals.totalTokens,
    unit: "tokens",
    cycle,
  };
  return [spend, requestCount, tokens];
}

function creditBalanceMetric(
  body: {
    total_granted: number;
    total_used: number;
    total_available: number;
    grants?: { data: { expires_at?: number | null }[] } | null;
  },
  now: number,
): BalanceMetric | undefined {
  if (!Number.isFinite(body.total_available)) return undefined;

  const nextExpiry = body.grants?.data
    .map((grant) => grant.expires_at)
    .filter((value): value is number => typeof value === "number")
    .map((seconds) => seconds * 1_000)
    .filter((milliseconds) => milliseconds > now)
    .sort((left, right) => left - right)[0];

  return {
    type: "balance",
    id: "balance",
    label: "Available credits",
    scope: "general",
    value: body.total_available,
    unit: "USD",
    ...(body.total_granted > 0 ? { initialLimit: body.total_granted } : {}),
    ...(nextExpiry === undefined ? {} : { cycle: { resetsAt: nextExpiry } }),
  };
}

async function fetchOrganizationUsage(
  context: {
    fetch: typeof globalThis.fetch;
    now: number;
    signal: AbortSignal;
    headers: Record<string, string>;
  },
): Promise<CollectionResult> {
  const costs = await fetchPaged(
    context,
    COSTS_URL,
    "line_item",
    (body) => openAiCostsResponseSchema.safeParse(body),
  );
  if (!costs.ok) return costs;

  const completions = await fetchPaged(
    context,
    COMPLETIONS_URL,
    "model",
    (body) => openAiCompletionsResponseSchema.safeParse(body),
  );
  if (!completions.ok) return completions;

  const metrics = usageMetrics(summarizeUsage(costs.pages, completions.pages));
  if (metrics === undefined) {
    return { ok: false, health: { kind: "provider_changed" } };
  }

  return {
    ok: true,
    snapshot: {
      providerKind: "openai",
      source: "api-key",
      fetchedAt: context.now,
      metrics,
    },
  };
}

async function fetchCreditGrants(
  context: {
    fetch: typeof globalThis.fetch;
    now: number;
    signal: AbortSignal;
    headers: Record<string, string>;
  },
): Promise<CollectionResult> {
  const response = await context.fetch(CREDIT_GRANTS_URL, {
    method: "GET",
    headers: context.headers,
    signal: context.signal,
  });
  if (!response.ok) {
    return { ok: false, health: healthForResponse(response, context.now) };
  }

  const parsed = openAiCreditGrantsResponseSchema.safeParse(
    await parseJson(response),
  );
  if (!parsed.success) {
    return { ok: false, health: { kind: "provider_changed" } };
  }

  const metric = creditBalanceMetric(parsed.data, context.now);
  if (metric === undefined) {
    return { ok: false, health: { kind: "provider_changed" } };
  }

  return {
    ok: true,
    snapshot: {
      providerKind: "openai",
      source: "api-key",
      fetchedAt: context.now,
      metrics: [metric],
    },
  };
}

async function collectOpenAI({
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
  const requestContext = { fetch, now, signal, headers };

  // Try organization usage first; when no project scope is set, fall back to
  // legacy credit grants on any usage failure.
  let usageFailure: Extract<CollectionResult, { ok: false; health: ProviderHealth }> =
    { ok: false, health: { kind: "temporary_error" } };
  try {
    const usage = await fetchOrganizationUsage(requestContext);
    if (usage.ok) return usage;
    if ("health" in usage) usageFailure = usage;
  } catch {
    usageFailure = { ok: false, health: { kind: "temporary_error" } };
  }

  try {
    const balance = await fetchCreditGrants(requestContext);
    if (balance.ok) return balance;
    if (usageFailure.health.kind !== "credential_invalid") {
      return usageFailure;
    }
    return balance;
  } catch {
    if (usageFailure.health.kind !== "credential_invalid") {
      return usageFailure;
    }
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const openAiAdapter: ProviderCollector<"openai"> = {
  id: "openai",
  collect: collectOpenAI,
};
