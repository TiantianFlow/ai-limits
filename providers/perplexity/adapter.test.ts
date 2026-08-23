import { describe, expect, test, vi } from "vitest";

import { perplexityAdapter } from "./adapter";

const NOW = Date.parse("2027-01-15T12:00:00.000Z");
const NOW_SECONDS = NOW / 1_000;
const RENEWAL_TS = 1_800_000_000;
const PROMO_EXPIRY_TS = NOW_SECONDS + 7 * 24 * 60 * 60;

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
function creditsFixture(overrides: Record<string, unknown> = {}) {
  return {
    balance_cents: 3_500,
    renewal_date_ts: RENEWAL_TS,
    current_period_purchased_cents: 1_000,
    credit_grants: [
      { type: "recurring", amount_cents: 10_000 },
      {
        type: "promotional",
        amount_cents: 500,
        expires_at_ts: PROMO_EXPIRY_TS,
      },
      { type: "purchased", amount_cents: 1_000 },
    ],
    total_usage_cents: 10_800,
    ...overrides,
  };
}

// Credit waterfall with the fixture above:
// recurring 10_000 -> used 10_000; purchased max(1_000, 1_000) -> used 800;
// promo 500 -> used 0.

describe("Perplexity adapter", () => {
  test("collects recurring, promo, and purchased credit pools", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(creditsFixture()));

    const result = await perplexityAdapter.collect(context(injectedFetch));

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "perplexity",
        planLabel: "Max",
        source: "web-session",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "recurring-credits",
            label: "Monthly recurring credits",
            scope: "product",
            usedRatio: 1,
            used: 100,
            limit: 100,
            unit: "USD",
            cycle: {
              cadence: "calendar",
              resetsAt: RENEWAL_TS * 1_000,
            },
          },
          {
            type: "quota",
            id: "promo-credits",
            label: "Promotional bonus credits",
            scope: "product",
            usedRatio: 0,
            used: 0,
            limit: 5,
            unit: "USD",
            cycle: { resetsAt: PROMO_EXPIRY_TS * 1_000 },
          },
          {
            type: "quota",
            id: "purchased-credits",
            label: "Purchased credits",
            scope: "product",
            usedRatio: 0.8,
            used: 8,
            limit: 10,
            unit: "USD",
            cycle: {},
          },
        ],
        usageGroups: [
          {
            id: "credits",
            label: "Credits",
            metricIds: [
              "recurring-credits",
              "promo-credits",
              "purchased-credits",
            ],
          },
        ],
      },
    });

    expect(injectedFetch).toHaveBeenCalledWith(
      "https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Origin: "https://www.perplexity.ai",
          Referer: "https://www.perplexity.ai/account/usage",
        },
      }),
    );
  });

  test("prefers the top-level purchased field when it exceeds the grant sum", async () => {
    // Use the larger of the grant sum and top-level field.
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          creditsFixture({
            current_period_purchased_cents: 2_500,
            credit_grants: [
              { type: "recurring", amount_cents: 10_000 },
              { type: "purchased", amount_cents: 1_000 },
            ],
            total_usage_cents: 10_800,
          }),
        ),
      );

    const result = await perplexityAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({
            id: "purchased-credits",
            used: 8,
            limit: 25,
          }),
        ]),
      },
    });
  });

  test("drops expired promotional grants", async () => {
    // Promotional grants past expiry are excluded; an empty promo pool renders
    // usedRatio 1.
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          creditsFixture({
            credit_grants: [
              { type: "recurring", amount_cents: 10_000 },
              {
                type: "promotional",
                amount_cents: 500,
                expires_at_ts: NOW_SECONDS - 60,
              },
            ],
          }),
        ),
      );

    const result = await perplexityAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({
            id: "promo-credits",
            usedRatio: 1,
            limit: 0,
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("expired");
  });

  test.each([
    [4_999, "Pro"],
    [5_000, "Max"],
  ])(
    "labels a %i-cent recurring allotment as %s",
    async (recurringCents, planLabel) => {
      // Recurring allotments below 5000 are Pro; larger ones are Max.
      const injectedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          response(
            creditsFixture({
              credit_grants: [
                { type: "recurring", amount_cents: recurringCents },
              ],
            }),
          ),
        );

      const result = await perplexityAdapter.collect(context(injectedFetch));

      expect(result).toMatchObject({
        ok: true,
        snapshot: { planLabel },
      });
    },
  );

  test("omits the plan label when no recurring allotment exists", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          creditsFixture({
            current_period_purchased_cents: 0,
            credit_grants: [],
            total_usage_cents: 0,
          }),
        ),
      );

    const result = await perplexityAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.planLabel).toBeUndefined();
      expect(result.snapshot.metrics).toEqual([
        expect.objectContaining({ id: "recurring-credits", usedRatio: 1 }),
        expect.objectContaining({ id: "promo-credits", usedRatio: 1 }),
        expect.objectContaining({ id: "purchased-credits", usedRatio: 1 }),
      ]);
    }
  });

  test.each([401, 403])(
    "maps HTTP %i to signed out",
    async (status) => {
      const injectedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({}, status));

      await expect(
        perplexityAdapter.collect(context(injectedFetch)),
      ).resolves.toEqual({
        ok: false,
        health: { kind: "signed_out" },
      });
    },
  );

  test.each([429, 500])("maps HTTP %i to a temporary error", async (status) => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, status));

    await expect(
      perplexityAdapter.collect(context(injectedFetch)),
    ).resolves.toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps an unexpected status to provider changed", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 418));

    await expect(
      perplexityAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    ["a malformed payload", { balance_cents: "lots" }],
    ["a non-JSON body", undefined],
  ] as const)("maps %s to provider changed", async (_label, body) => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      body === undefined
        ? new Response("<html>oops</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          })
        : response(body),
    );

    await expect(
      perplexityAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a thrown request to a temporary error", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("network down"));

    await expect(
      perplexityAdapter.collect(context(injectedFetch)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
