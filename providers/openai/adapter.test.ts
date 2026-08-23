import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { OPENAI_HISTORY_DAYS, openAiAdapter, openaiDailyRanges } from "./adapter";

// Fixtures are observed in an upstream test suite, not a live same-origin
// capture.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-test-credential";
const COSTS_URL = "https://api.openai.com/v1/organization/costs";
const COMPLETIONS_URL = "https://api.openai.com/v1/organization/usage/completions";
const CREDIT_GRANTS_URL =
  "https://api.openai.com/v1/dashboard/billing/credit_grants";
const DAY_MS = 24 * 60 * 60 * 1_000;

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

function emptyPage() {
  return { object: "page", data: [], has_more: false, next_page: null };
}

function costsFixture() {
  return {
    object: "page",
    data: [
      {
        object: "bucket",
        start_time: 1_700_000_000,
        end_time: 1_700_086_400,
        results: [
          {
            object: "organization.costs.result",
            amount: { value: 12.5, currency: "usd" },
            line_item: "Text tokens",
          },
          {
            object: "organization.costs.result",
            amount: { value: "2.25", currency: "usd" },
            line_item: "Web search tool calls",
          },
        ],
      },
      {
        object: "bucket",
        start_time: 1_700_086_400,
        end_time: 1_700_172_800,
        results: [
          {
            object: "organization.costs.result",
            amount: { value: 4.0, currency: "usd" },
            line_item: "Text tokens",
          },
        ],
      },
    ],
    has_more: false,
    next_page: null,
  };
}

function completionsFixture() {
  return {
    object: "page",
    data: [
      {
        object: "bucket",
        start_time: 1_700_000_000,
        end_time: 1_700_086_400,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000,
            input_cached_tokens: 250,
            output_tokens: 500,
            num_model_requests: 7,
            model: "gpt-5.2",
          },
          {
            object: "organization.usage.completions.result",
            input_tokens: 300,
            output_tokens: 200,
            num_model_requests: 3,
            model: "gpt-5.2-codex",
          },
        ],
      },
      {
        object: "bucket",
        start_time: 1_700_086_400,
        end_time: 1_700_172_800,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 200,
            output_tokens: 100,
            num_model_requests: 2,
            model: "gpt-5.2",
          },
        ],
      },
    ],
    has_more: false,
    next_page: null,
  };
}

function creditGrantsFixture() {
  return {
    object: "credit_summary",
    total_granted: 25.5,
    total_used: 7.25,
    total_available: 18.25,
    grants: {
      object: "list",
      data: [
        {
          grant_amount: 10.0,
          used_amount: 1.0,
          effective_at: 1_690_000_000,
          expires_at: 1_800_000_000,
        },
      ],
    },
  };
}

function expectedOrganizationUrl(
  base: string,
  groupBy: "line_item" | "model",
  page?: string,
): string {
  const [range] = openaiDailyRanges(NOW);
  const url = new URL(base);
  url.searchParams.set("start_time", String(range!.startTime));
  url.searchParams.set("end_time", String(range!.endTime));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", String(range!.limit));
  url.searchParams.set("group_by", groupBy);
  if (page) url.searchParams.set("page", page);
  return url.toString();
}

function usageFetch(
  costs: Response,
  completions: Response,
  credits?: Response,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith(COSTS_URL)) return costs;
    if (url.startsWith(COMPLETIONS_URL)) return completions;
    if (url.startsWith(CREDIT_GRANTS_URL)) {
      return credits ?? response({}, 404);
    }
    throw new Error(`unexpected url ${url}`);
  });
  return fetch;
}

describe("OpenAI adapter", () => {
  test("requests organization costs and completions and sums the 30-day window", async () => {
    const controller = new AbortController();
    const fetch = usageFetch(response(costsFixture()), response(completionsFixture()));

    const result = await openAiAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    const expectedHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${TEST_CREDENTIAL}`,
    };
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expectedOrganizationUrl(COSTS_URL, "line_item"),
      { method: "GET", headers: expectedHeaders, signal: controller.signal },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expectedOrganizationUrl(COMPLETIONS_URL, "model"),
      { method: "GET", headers: expectedHeaders, signal: controller.signal },
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "openai",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "counter",
            id: "last-30-days-spend",
            label: "Last 30 days spend",
            scope: "general",
            semantic: "spent",
            value: 18.75,
            unit: "USD",
            cycle: { cadence: "rolling", durationMs: OPENAI_HISTORY_DAYS * DAY_MS },
          },
          {
            type: "counter",
            id: "last-30-days-requests",
            label: "Last 30 days requests",
            scope: "general",
            semantic: "consumed",
            value: 12,
            unit: "requests",
            cycle: { cadence: "rolling", durationMs: OPENAI_HISTORY_DAYS * DAY_MS },
          },
          {
            type: "counter",
            id: "last-30-days-tokens",
            label: "Last 30 days tokens",
            scope: "general",
            semantic: "consumed",
            value: 2300,
            unit: "tokens",
            cycle: { cadence: "rolling", durationMs: OPENAI_HISTORY_DAYS * DAY_MS },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("treats an empty organization page as zero usage", async () => {
    const fetch = usageFetch(response(emptyPage()), response(emptyPage()));

    await expect(openAiAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { id: "last-30-days-spend", value: 0 },
          { id: "last-30-days-requests", value: 0 },
          { id: "last-30-days-tokens", value: 0 },
        ],
      },
    });
  });

  test("follows a costs pagination cursor", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith(COSTS_URL)) {
        const page = new URL(url).searchParams.get("page");
        if (page === null) {
          return response({
            data: [
              {
                start_time: 1_700_000_000,
                end_time: 1_700_086_400,
                results: [{ amount: { value: 1, currency: "usd" } }],
              },
            ],
            has_more: true,
            next_page: "costs_page_2",
          });
        }
        if (page === "costs_page_2") {
          return response({
            data: [
              {
                start_time: 1_700_086_400,
                end_time: 1_700_172_800,
                results: [{ amount: { value: 3, currency: "usd" } }],
              },
            ],
            has_more: false,
            next_page: null,
          });
        }
      }
      if (url.startsWith(COMPLETIONS_URL)) return response(emptyPage());
      return response({}, 404);
    });

    const result = await openAiAdapter.collect(context(fetch));

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      expectedOrganizationUrl(COSTS_URL, "line_item"),
      expectedOrganizationUrl(COSTS_URL, "line_item", "costs_page_2"),
      expectedOrganizationUrl(COMPLETIONS_URL, "model"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.snapshot.metrics.find((metric) => metric.id === "last-30-days-spend"),
      ).toMatchObject({ value: 4 });
    }
  });

  test("maps a repeated pagination cursor to provider changed when credits also fail", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith(COSTS_URL)) {
        return response({
          data: [],
          has_more: true,
          next_page: "same-cursor",
        });
      }
      return response({}, 404);
    });

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("falls back to credit grants when organization usage rejects the key", async () => {
    const fetch = usageFetch(
      response({}, 403),
      response(emptyPage()),
      response(creditGrantsFixture()),
    );

    const result = await openAiAdapter.collect(context(fetch));

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      expectedOrganizationUrl(COSTS_URL, "line_item"),
      CREDIT_GRANTS_URL,
    ]);
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "openai",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "balance",
            id: "balance",
            label: "Available credits",
            scope: "general",
            value: 18.25,
            unit: "USD",
            initialLimit: 25.5,
          },
        ],
      },
    });
  });

  test("keeps a still-future credit grant expiry from the observed fixture", async () => {
    const now = 1_700_000_000_000;
    const fetch = usageFetch(
      response({}, 403),
      response(emptyPage()),
      response(creditGrantsFixture()),
    );

    await expect(openAiAdapter.collect(context(fetch, { now }))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        fetchedAt: now,
        metrics: [{ id: "balance", cycle: { resetsAt: 1_800_000_000_000 } }],
      },
    });
  });

  test("keeps the usage health when fallback credits also fail and usage was not a credential rejection", async () => {
    const fetch = usageFetch(
      response({}, 500),
      response(emptyPage()),
      response({}, 401),
    );

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps credential rejection on both usage and credits to credential invalid", async () => {
    const fetch = usageFetch(
      response({}, 401),
      response(emptyPage()),
      response({}, 401),
    );

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
  });

  test("maps a non-finite cost amount to provider changed when credits fail", async () => {
    const fetch = usageFetch(
      response({
        data: [
          {
            start_time: 1_700_000_000,
            end_time: 1_700_086_400,
            results: [{ amount: { value: "NaN", currency: "usd" } }],
          },
        ],
        has_more: false,
        next_page: null,
      }),
      response(emptyPage()),
      response({}, 404),
    );

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    ["missing", undefined],
    ["wrong kind", { kind: "browser-session", value: TEST_CREDENTIAL }],
    ["blank", { kind: "api-key", value: "   " }],
  ])("refuses a %s credential without making a request", async (_name, credential) => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      openAiAdapter.collect(
        context(fetch, {
          credential: credential as CollectionContext["credential"],
        }),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = usageFetch(
      response({}, 429, { "Retry-After": "45" }),
      response(emptyPage()),
      response({}, 404),
    );

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 45_000 },
    });
  });

  test("maps malformed organization JSON to provider changed when credits fail", async () => {
    const fetch = usageFetch(
      new Response("{broken", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      response(emptyPage()),
      response({}, 404),
    );

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a thrown network error to a temporary error when credits also fail", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(openAiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("builds a single 30-day UTC range under the 31-day bucket cap", () => {
    const ranges = openaiDailyRanges(NOW);
    expect(ranges).toHaveLength(1);
    const range = ranges[0];
    expect(range?.limit).toBe(30);
    expect((range?.endTime ?? 0) - (range?.startTime ?? 0)).toBe(30 * 86_400);
  });
});
