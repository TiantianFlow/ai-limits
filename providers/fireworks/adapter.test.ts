import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { fireworksAdapter } from "./adapter";

// Fixtures mirror the wire shapes decoded by the upstream reference
// implementation.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
const TEST_CREDENTIAL = "synthetic-test-credential";
const ACCOUNTS_URL = "https://api.fireworks.ai/v1/accounts";

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

function accountsFixture(overrides: Record<string, unknown> = {}) {
  return {
    accounts: [
      {
        name: "accounts/fireworks-user-1",
        accountId: "fireworks-user-1",
        id: "fireworks-user-1",
      },
    ],
    nextPageToken: null,
    ...overrides,
  };
}

function summaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    lineItems: [
      {
        category: "SERVERLESS",
        groupingKey: "MODEL",
        groupingValue: "accounts/fireworks/models/llama-v3p1-8b-instruct",
        quantity: 12_345,
        totalCost: { currencyCode: "USD", nanos: 250_000_000, units: "3" },
      },
      {
        category: "SERVERLESS",
        groupingKey: "MODEL",
        groupingValue: "accounts/fireworks/models/mixtral-8x7b-instruct",
        quantity: 678,
        totalCost: { currencyCode: "USD", nanos: 0, units: "1.5" },
      },
    ],
    ...overrides,
  };
}

function sequencedFetch(
  accounts: Response,
  summary: Response,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(accounts)
    .mockResolvedValueOnce(summary);
}

function expectedSummaryUrl(slug: string): string {
  const start = new Date(NOW - LOOKBACK_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const end = new Date(NOW).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `https://api.fireworks.ai/v1/accounts/${slug}/billing/summary?startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}`;
}

describe("Fireworks adapter", () => {
  test("discovers the single account and normalizes the 30-day spend", async () => {
    const controller = new AbortController();
    const fetch = sequencedFetch(
      response(accountsFixture()),
      response(summaryFixture()),
    );

    const result = await fireworksAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    const expectedHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${TEST_CREDENTIAL}`,
    };
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, ACCOUNTS_URL, {
      method: "GET",
      headers: expectedHeaders,
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expectedSummaryUrl("fireworks-user-1"),
      { method: "GET", headers: expectedHeaders, signal: controller.signal },
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "fireworks",
        accountLabel: "fireworks-user-1",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "counter",
            id: "last-30-days-spend",
            label: "Last 30 days spend",
            scope: "general",
            semantic: "spent",
            value: 4.75,
            unit: "USD",
            cycle: { cadence: "rolling", durationMs: LOOKBACK_MS },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("derives the slug from the last name segment when ids are absent", async () => {
    const fetch = sequencedFetch(
      response(
        accountsFixture({
          accounts: [{ name: "accounts/team-slug" }],
        }),
      ),
      response(summaryFixture()),
    );

    const result = await fireworksAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expectedSummaryUrl("team-slug"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      ok: true,
      snapshot: { accountLabel: "team-slug" },
    });
  });

  test("ignores line items in a different currency than the first rated row", async () => {
    const fetch = sequencedFetch(
      response(accountsFixture()),
      response(
        summaryFixture({
          lineItems: [
            { totalCost: { currencyCode: "EUR", nanos: 0, units: "2" } },
            { totalCost: { currencyCode: "USD", nanos: 0, units: "99" } },
          ],
        }),
      ),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { metrics: [{ value: 2, unit: "EUR" }] },
    });
  });

  test("skips unrated line items while keeping rated ones", async () => {
    const fetch = sequencedFetch(
      response(accountsFixture()),
      response(
        summaryFixture({
          lineItems: [
            { totalCost: null },
            { totalCost: { currencyCode: "USD", nanos: null, units: "1" } },
            { totalCost: { currencyCode: "USD", nanos: 500_000_000, units: "1" } },
          ],
        }),
      ),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { metrics: [{ value: 1.5, unit: "USD" }] },
    });
  });

  test("maps an empty billing summary to provider changed", async () => {
    const fetch = sequencedFetch(
      response(accountsFixture()),
      response(summaryFixture({ lineItems: [] })),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps zero accounts to provider changed", async () => {
    const fetch = sequencedFetch(
      response(accountsFixture({ accounts: [] })),
      response(summaryFixture()),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("maps multiple accounts to provider changed", async () => {
    const fetch = sequencedFetch(
      response(
        accountsFixture({
          accounts: [
            { accountId: "first-account" },
            { accountId: "second-account" },
          ],
        }),
      ),
      response(summaryFixture()),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("maps a malformed accounts payload to provider changed", async () => {
    const fetch = sequencedFetch(
      response({ accounts: "not-an-array" }),
      response(summaryFixture()),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps malformed summary JSON to provider changed", async () => {
    const fetch = sequencedFetch(
      response(accountsFixture()),
      new Response("{broken", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    ["accounts", 0],
    ["summary", 1],
  ])(
    "maps HTTP 403 on the %s call to credential invalid",
    async (_name, failureIndex) => {
      const responses = [response(accountsFixture()), response(summaryFixture())];
      responses[failureIndex] = response({}, 403);
      const fetch = sequencedFetch(responses[0]!, responses[1]!);

      await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
        ok: false,
        health: { kind: "credential_invalid" },
      });
    },
  );

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = sequencedFetch(
      response(accountsFixture()),
      response({}, 429, { "Retry-After": "30" }),
    );

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 30_000 },
    });
  });

  test("maps HTTP 500 on the accounts call to a temporary error", async () => {
    const fetch = sequencedFetch(response({}, 500), response(summaryFixture()));

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps HTTP 404 on the summary call to provider changed", async () => {
    const fetch = sequencedFetch(response(accountsFixture()), response({}, 404));

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
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
      fireworksAdapter.collect(
        context(fetch, {
          credential: credential as CollectionContext["credential"],
        }),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(fireworksAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
