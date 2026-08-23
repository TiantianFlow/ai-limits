import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { groqCloudAdapter } from "./adapter";

// Fixtures are observed in an upstream test suite, not a live same-origin
// capture.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-test-credential";
const QUERY_URL = "https://api.groq.com/v1/metrics/prometheus/api/v1/query";
const FIVE_MINUTES_MS = 5 * 60 * 1_000;

const REQUESTS_QUERY = "sum(model_project_id_status_code:requests:rate5m)";
const INPUT_TOKENS_QUERY = "sum(model_project_id:tokens_in:rate5m)";
const OUTPUT_TOKENS_QUERY = "sum(model_project_id:tokens_out:rate5m)";
const CACHE_HITS_QUERY = "sum(model_project_id:prompt_cache_hits:rate5m)";

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function context(
  fetch: typeof globalThis.fetch,
  overrides: Partial<CollectionContext> = {},
): CollectionContext {
  return {
    fetch,
    now: NOW,
    signal: new AbortController().signal,
    credential: { kind: "api-key", value: TEST_CREDENTIAL },
    ...overrides,
  };
}

function prometheusFixture(values: Array<number | string>) {
  return {
    status: "success",
    data: {
      result: values.map((value) => ({ value: [1_710_000_000, value] })),
    },
  };
}

function queryFrom(url: string): string | null {
  return new URL(url).searchParams.get("query");
}

function groqFetch(
  byQuery: Record<string, Response>,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    const query = queryFrom(url);
    if (!query || !url.startsWith(QUERY_URL)) {
      throw new Error(`unexpected url ${url}`);
    }
    const matched = byQuery[query];
    if (!matched) throw new Error(`unexpected query ${query}`);
    return matched;
  });
}

function successByQuery(overrides: Record<string, Response> = {}) {
  return {
    [REQUESTS_QUERY]: response(prometheusFixture(["2"])),
    [INPUT_TOKENS_QUERY]: response(prometheusFixture(["100"])),
    [OUTPUT_TOKENS_QUERY]: response(prometheusFixture(["50"])),
    [CACHE_HITS_QUERY]: response(prometheusFixture(["0"])),
    ...overrides,
  };
}

describe("GroqCloud adapter", () => {
  test("queries Prometheus rates and converts them to per-minute counters", async () => {
    const controller = new AbortController();
    const fetch = groqFetch(successByQuery());

    const result = await groqCloudAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    const expectedHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${TEST_CREDENTIAL}`,
    };
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const query of [
      REQUESTS_QUERY,
      INPUT_TOKENS_QUERY,
      OUTPUT_TOKENS_QUERY,
      CACHE_HITS_QUERY,
    ]) {
      const url = new URL(QUERY_URL);
      url.searchParams.set("query", query);
      expect(fetch).toHaveBeenCalledWith(url.toString(), {
        method: "GET",
        headers: expectedHeaders,
        signal: controller.signal,
      });
    }
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "groqcloud",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "counter",
            id: "requests-per-minute",
            label: "Requests per minute",
            scope: "general",
            semantic: "consumed",
            value: 120,
            unit: "req/min",
            cycle: { cadence: "rolling", durationMs: FIVE_MINUTES_MS },
          },
          {
            type: "counter",
            id: "tokens-per-minute",
            label: "Tokens per minute",
            scope: "general",
            semantic: "consumed",
            value: 9000,
            unit: "tok/min",
            cycle: { cadence: "rolling", durationMs: FIVE_MINUTES_MS },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("sums multiple Prometheus series in one query", async () => {
    const fetch = groqFetch(
      successByQuery({
        [REQUESTS_QUERY]: response(prometheusFixture(["2.5", "1.5"])),
      }),
    );

    const result = await groqCloudAdapter.collect(context(fetch));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.snapshot.metrics.find((metric) => metric.id === "requests-per-minute"),
      ).toMatchObject({ value: 240 });
    }
  });

  test("includes cache hits only when the rate is positive", async () => {
    const fetch = groqFetch(
      successByQuery({
        [CACHE_HITS_QUERY]: response(prometheusFixture(["3"])),
      }),
    );

    const result = await groqCloudAdapter.collect(context(fetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { id: "requests-per-minute" },
          { id: "tokens-per-minute" },
          {
            id: "cache-hits-per-minute",
            value: 180,
            unit: "cache/min",
          },
        ],
      },
    });
  });

  test("treats an empty Prometheus result as a zero rate", async () => {
    const fetch = groqFetch(
      successByQuery({
        [REQUESTS_QUERY]: response({ status: "success", data: { result: [] } }),
        [INPUT_TOKENS_QUERY]: response({ status: "success", data: { result: [] } }),
        [OUTPUT_TOKENS_QUERY]: response({ status: "success", data: { result: [] } }),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { id: "requests-per-minute", value: 0 },
          { id: "tokens-per-minute", value: 0 },
        ],
      },
    });
  });

  test("maps a non-success Prometheus status to provider changed", async () => {
    const fetch = groqFetch(
      successByQuery({
        [REQUESTS_QUERY]: response({ status: "error", error: "query failed" }),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps HTTP 404 to credential scope required", async () => {
    const fetch = groqFetch(
      successByQuery({
        [REQUESTS_QUERY]: response({}, 404),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_scope_required" },
    });
  });

  test.each([401, 403])("maps HTTP %i to credential invalid", async (status) => {
    const fetch = groqFetch(
      successByQuery({
        [REQUESTS_QUERY]: response({}, status),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
  });

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = groqFetch(
      successByQuery({
        [INPUT_TOKENS_QUERY]: response({}, 429, { "Retry-After": "15" }),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 15_000 },
    });
  });

  test.each([500, 503])("maps HTTP %i to a temporary error", async (status) => {
    const fetch = groqFetch(
      successByQuery({
        [OUTPUT_TOKENS_QUERY]: response({}, status),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test.each([
    ["missing", undefined],
    ["wrong kind", { kind: "browser-session", value: TEST_CREDENTIAL }],
    ["blank", { kind: "api-key", value: "   " }],
  ])("refuses a %s credential without making a request", async (_name, credential) => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      groqCloudAdapter.collect(
        context(fetch, {
          credential: credential as CollectionContext["credential"],
        }),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("maps malformed JSON to provider changed", async () => {
    const fetch = groqFetch(
      successByQuery({
        [REQUESTS_QUERY]: new Response("{broken", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      }),
    );

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(groqCloudAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
