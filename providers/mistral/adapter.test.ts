import { describe, expect, test, vi } from "vitest";

import { mistralAdapter } from "./adapter";

// NOW is 2027-01-15T12:00:00.000Z -> month=1, year=2027 in the UTC query.
const NOW = Date.parse("2027-01-15T12:00:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(
  fetch: typeof globalThis.fetch,
  signal = new AbortController().signal,
) {
  return { fetch, now: NOW, signal };
}

// Fixture marked INFERRED: field shapes follow the upstream decode models,
// not a captured live response.
function billingFixture(overrides: Record<string, unknown> = {}) {
  return {
    completion: {
      models: {
        "mistral-large-latest": {
          input: [
            {
              timestamp: "2027-01-02T00:00:00Z",
              value: 1_000,
              value_paid: 900,
              billing_metric: "tokens",
              billing_group: "input",
            },
          ],
          output: [
            {
              timestamp: "2027-01-02T00:01:00Z",
              value: 500,
              billing_metric: "tokens",
              billing_group: "output",
            },
          ],
          cached: [
            {
              timestamp: "2027-01-02T00:02:00Z",
              value: 100,
              billing_metric: "tokens",
              billing_group: "cached",
            },
          ],
        },
      },
    },
    currency: "usd",
    start_date: "2027-01-01T00:00:00Z",
    end_date: "2027-02-01T00:00:00Z",
    prices: [
      { billing_metric: "tokens", billing_group: "input", price: "0.005" },
      { billing_metric: "tokens", billing_group: "output", price: "0.01" },
      { billing_metric: "tokens", billing_group: "cached", price: "0.001" },
    ],
    ...overrides,
  };
}

// Expected cost: 900*0.005 + 500*0.01 + 100*0.001 = 4.5 + 5 + 0.1 = 9.6.
const EXPECTED_COST = 9.6;

describe("Mistral adapter", () => {
  test("collects month spend and credits without leaking raw entries", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(billingFixture()))
      .mockResolvedValueOnce(
        response({
          wallet_amount: 20,
          credit_notes_amount: 5,
          ongoing_usage_balance: 7.5,
          currency: "usd",
        }),
      );

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "mistral",
        source: "web-session",
        fetchedAt: NOW,
        metrics: [
          {
            type: "counter",
            id: "month-spend",
            label: "Spend this month",
            scope: "general",
            semantic: "spent",
            unit: "USD",
            value: EXPECTED_COST,
            cycle: { cadence: "calendar" },
          },
          {
            type: "balance",
            id: "credits",
            label: "Credits",
            scope: "product",
            unit: "USD",
            value: 17.5,
          },
        ],
        usageGroups: [
          { id: "usage", label: "Usage", metricIds: ["month-spend", "credits"] },
        ],
      },
    });

    expect(injectedFetch).toHaveBeenNthCalledWith(
      1,
      "https://admin.mistral.ai/api/billing/v2/usage?month=1&year=2027",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "*/*",
          Referer: "https://admin.mistral.ai/organization/usage",
          Origin: "https://admin.mistral.ai",
        },
      }),
    );
    expect(injectedFetch).toHaveBeenNthCalledWith(
      2,
      "https://admin.mistral.ai/api/billing/credits",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "*/*",
          Referer: "https://admin.mistral.ai/organization/billing",
          Origin: "https://admin.mistral.ai",
        },
      }),
    );
    // Raw per-entry timestamps/values are aggregation inputs only.
    expect(JSON.stringify(result)).not.toContain("2027-01-02");
  });

  test("prefers value_paid over value for spend", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          billingFixture({
            prices: [
              { billing_metric: "tokens", billing_group: "input", price: "1" },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(response({}, 500));

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          expect.objectContaining({ id: "month-spend", value: 900 }),
        ],
      },
    });
  });

  test("treats unknown price groups as zero cost instead of failing", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(billingFixture({ prices: [] })))
      .mockResolvedValueOnce(response({}, 500));

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [expect.objectContaining({ id: "month-spend", value: 0 })],
      },
    });
  });

  test("clamps a negative total cost to zero (refund adjustment)", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          billingFixture({
            prices: [
              { billing_metric: "tokens", billing_group: "input", price: "-1" },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(response({}, 500));

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [expect.objectContaining({ id: "month-spend", value: 0 })],
      },
    });
  });

  test("normalizes a blank currency to XXX", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(billingFixture({ currency: "  " })))
      .mockResolvedValueOnce(response({}, 500));

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [expect.objectContaining({ id: "month-spend", unit: "XXX" })],
      },
    });
  });

  test("keeps the spend metric when the credits probe fails", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(billingFixture()))
      .mockRejectedValueOnce(new TypeError("network down"));

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [expect.objectContaining({ id: "month-spend" })],
        usageGroups: [
          { id: "usage", label: "Usage", metricIds: ["month-spend"] },
        ],
      },
    });
  });

  test("keeps the spend metric when the credits payload is malformed", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(billingFixture()))
      .mockResolvedValueOnce(response({ wallet_amount: "a lot" }));

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [expect.objectContaining({ id: "month-spend" })],
      },
    });
  });

  test("clamps a negative credits balance to zero", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(billingFixture()))
      .mockResolvedValueOnce(
        response({
          wallet_amount: 1,
          credit_notes_amount: 0,
          ongoing_usage_balance: 5,
          currency: "EUR",
        }),
      );

    const result = await mistralAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          expect.objectContaining({ id: "month-spend" }),
          expect.objectContaining({ id: "credits", value: 0, unit: "EUR" }),
        ],
      },
    });
  });

  test.each([401, 403])(
    "maps a usage HTTP %i to signed out",
    async (status) => {
      const injectedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({}, status));

      await expect(
        mistralAdapter.collect(context(injectedFetch)),
      ).resolves.toEqual({
        ok: false,
        health: { kind: "signed_out" },
      });
      expect(injectedFetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each([429, 500])(
    "maps a usage HTTP %i to a temporary error",
    async (status) => {
      const injectedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({}, status));

      await expect(
        mistralAdapter.collect(context(injectedFetch)),
      ).resolves.toMatchObject({
        ok: false,
        health: { kind: "temporary_error" },
      });
    },
  );

  test("maps an unexpected usage status to provider changed", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 418));

    await expect(
      mistralAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a malformed usage payload to provider changed", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ completion: "not-an-object" }));

    await expect(
      mistralAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a non-JSON usage body to provider changed", async () => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      mistralAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a thrown usage request to a temporary error", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("network down"));

    await expect(
      mistralAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
