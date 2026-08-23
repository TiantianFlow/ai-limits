import type { CounterMetric, ProviderHealth } from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import { groqPrometheusResponseSchema } from "./schema";

// The upstream reference implementation defaults to https://api.groq.com/v1
// and appends metrics/prometheus/api/v1/query.
const PROMETHEUS_QUERY_URL =
  "https://api.groq.com/v1/metrics/prometheus/api/v1/query";

// Queries used by the upstream reference implementation.
const REQUESTS_QUERY = "sum(model_project_id_status_code:requests:rate5m)";
const INPUT_TOKENS_QUERY = "sum(model_project_id:tokens_in:rate5m)";
const OUTPUT_TOKENS_QUERY = "sum(model_project_id:tokens_out:rate5m)";
const CACHE_HITS_QUERY = "sum(model_project_id:prompt_cache_hits:rate5m)";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401 || response.status === 403) {
    return { kind: "credential_invalid" };
  }

  // Standard organization keys return 404 on this enterprise Prometheus surface.
  if (response.status === 404) {
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

function queryUrl(query: string): string {
  const url = new URL(PROMETHEUS_QUERY_URL);
  url.searchParams.set("query", query);
  return url.toString();
}

function scalarFromValue(
  value: Array<number | string> | null | undefined,
): number | undefined {
  const last = value?.at(-1);
  if (typeof last === "number") {
    return Number.isFinite(last) ? last : undefined;
  }
  if (typeof last !== "string") return undefined;
  const parsed = Number(last);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Status must be "success"; series last-values are summed and missing series
// become zero, matching the upstream reference implementation.
export function parseGroqPrometheusScalar(body: unknown): number | undefined {
  const parsed = groqPrometheusResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.status !== "success") return undefined;
  return (
    parsed.data.data?.result.reduce((sum, series) => {
      const value = scalarFromValue(series.value);
      return value === undefined ? sum : sum + value;
    }, 0) ?? 0
  );
}

function rateCounter(
  id: string,
  label: string,
  perSecond: number,
  unit: string,
): CounterMetric | undefined {
  if (!Number.isFinite(perSecond) || perSecond < 0) return undefined;
  return {
    type: "counter",
    id,
    label,
    scope: "general",
    semantic: "consumed",
    value: perSecond * 60,
    unit,
    cycle: { cadence: "rolling", durationMs: FIVE_MINUTES_MS },
  };
}

async function queryScalar(
  query: string,
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
): Promise<{ ok: true; value: number } | { ok: false; health: ProviderHealth }> {
  const response = await fetch(queryUrl(query), {
    method: "GET",
    headers,
    signal,
  });
  if (!response.ok) {
    return { ok: false, health: healthForResponse(response, now) };
  }
  const value = parseGroqPrometheusScalar(await parseJson(response));
  if (value === undefined) {
    return { ok: false, health: { kind: "provider_changed" } };
  }
  return { ok: true, value };
}

async function collectGroqCloud({
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
  const context = { fetch, now, signal, headers };

  try {
    const [requests, inputTokens, outputTokens, cacheHits] = await Promise.all([
      queryScalar(REQUESTS_QUERY, context),
      queryScalar(INPUT_TOKENS_QUERY, context),
      queryScalar(OUTPUT_TOKENS_QUERY, context),
      queryScalar(CACHE_HITS_QUERY, context),
    ]);

    for (const result of [requests, inputTokens, outputTokens, cacheHits]) {
      if (!result.ok) return result;
    }
    if (
      !requests.ok ||
      !inputTokens.ok ||
      !outputTokens.ok ||
      !cacheHits.ok
    ) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const requestMetric = rateCounter(
      "requests-per-minute",
      "Requests per minute",
      requests.value,
      "req/min",
    );
    const tokenMetric = rateCounter(
      "tokens-per-minute",
      "Tokens per minute",
      inputTokens.value + outputTokens.value,
      "tok/min",
    );
    if (requestMetric === undefined || tokenMetric === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metrics = [requestMetric, tokenMetric];
    // The upstream reference implementation omits the cache window at zero.
    if (cacheHits.value > 0) {
      const cacheMetric = rateCounter(
        "cache-hits-per-minute",
        "Cache hits per minute",
        cacheHits.value,
        "cache/min",
      );
      if (cacheMetric === undefined) {
        return { ok: false, health: { kind: "provider_changed" } };
      }
      metrics.push(cacheMetric);
    }

    return {
      ok: true,
      snapshot: {
        providerKind: "groqcloud",
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const groqCloudAdapter: ProviderCollector<"groqcloud"> = {
  id: "groqcloud",
  collect: collectGroqCloud,
};
