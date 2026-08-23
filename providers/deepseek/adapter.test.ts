import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { deepSeekAdapter } from "./adapter";

// Fixtures mirror the wire shape decoded by CodexBar
// Sources/CodexBarCore/Providers/DeepSeek/DeepSeekUsageFetcher.swift
// (`DeepSeekBalanceResponse`/`DeepSeekBalanceInfo`, lines 8-30): balances are
// string-typed decimals.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-test-credential";

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

function balanceFixture(overrides: Record<string, unknown> = {}) {
  return {
    is_available: true,
    balance_infos: [
      {
        currency: "USD",
        total_balance: "12.50",
        granted_balance: "2.50",
        topped_up_balance: "10.00",
      },
    ],
    ...overrides,
  };
}

describe("DeepSeek adapter", () => {
  test("requests the balance with the API key and normalizes the USD row", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(balanceFixture()));

    const result = await deepSeekAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TEST_CREDENTIAL}`,
      },
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "deepseek",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "balance",
            id: "balance",
            label: "Balance",
            scope: "general",
            value: 12.5,
            unit: "USD",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("prefers a funded USD row over other currencies", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          balance_infos: [
            {
              currency: "CNY",
              total_balance: "99.00",
              granted_balance: "0.00",
              topped_up_balance: "99.00",
            },
            {
              currency: "USD",
              total_balance: "3.25",
              granted_balance: "0.00",
              topped_up_balance: "3.25",
            },
          ],
        }),
      ),
    );

    const result = await deepSeekAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: { metrics: [{ value: 3.25, unit: "USD" }] },
    });
  });

  test("falls back to a funded non-USD row when USD is empty", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          balance_infos: [
            {
              currency: "USD",
              total_balance: "0.00",
              granted_balance: "0.00",
              topped_up_balance: "0.00",
            },
            {
              currency: "CNY",
              total_balance: "8.10",
              granted_balance: "8.10",
              topped_up_balance: "0.00",
            },
          ],
        }),
      ),
    );

    const result = await deepSeekAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: { metrics: [{ value: 8.1, unit: "CNY" }] },
    });
  });

  test("preserves a valid zero balance", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          balance_infos: [
            {
              currency: "USD",
              total_balance: "0.00",
              granted_balance: "0.00",
              topped_up_balance: "0.00",
            },
          ],
        }),
      ),
    );

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { metrics: [{ type: "balance", value: 0, unit: "USD" }] },
    });
  });

  test("maps an empty balance list to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(balanceFixture({ balance_infos: [] })),
    );

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a non-numeric string balance to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          balance_infos: [
            {
              currency: "USD",
              total_balance: "lots",
              granted_balance: "0.00",
              topped_up_balance: "0.00",
            },
          ],
        }),
      ),
    );

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a number-typed balance field to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          balance_infos: [
            {
              currency: "USD",
              total_balance: 12.5,
              granted_balance: "0.00",
              topped_up_balance: "12.50",
            },
          ],
        }),
      ),
    );

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
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
      deepSeekAdapter.collect(
        context(fetch, {
          credential: credential as CollectionContext["credential"],
        }),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([401, 403])("maps HTTP %i to credential invalid", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, status));

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
  });

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 429, { "Retry-After": "120" }));

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
  });

  test.each([500, 503])("maps HTTP %i to a temporary error", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, status));

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps an unexpected HTTP status to provider changed", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 418));

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps malformed JSON to provider changed", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response("{broken", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(deepSeekAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
