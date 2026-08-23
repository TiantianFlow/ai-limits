import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { moonshotAdapter } from "./adapter";

// Fixtures mirror the wire shape decoded by the upstream reference
// implementation.
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
    code: 0,
    status: true,
    scode: "0",
    data: {
      available_balance: 7.89,
      voucher_balance: 1.23,
      cash_balance: 6.66,
    },
    ...overrides,
  };
}

describe("Moonshot adapter", () => {
  test("requests the international balance endpoint and normalizes available balance", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(balanceFixture()));

    const result = await moonshotAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.moonshot.ai/v1/users/me/balance",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${TEST_CREDENTIAL}`,
        },
        signal: controller.signal,
      },
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "moonshot",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "balance",
            id: "balance",
            label: "Balance",
            scope: "general",
            value: 7.89,
            unit: "USD",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("preserves a negative available balance from a deficit account", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          data: { available_balance: -1.5, voucher_balance: 0, cash_balance: -1.5 },
        }),
      ),
    );

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { metrics: [{ type: "balance", value: -1.5, unit: "USD" }] },
    });
  });

  test("treats a non-zero API code in a 200 envelope as provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          code: 40101,
          status: false,
          scode: "invalid_authentication",
        }),
      ),
    );

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("treats status false in a 200 envelope as provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(balanceFixture({ status: false })),
    );

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a missing data envelope to provider changed", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ code: 0, status: true, scode: "0" }));

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a string-typed balance to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        balanceFixture({
          data: { available_balance: "7.89" },
        }),
      ),
    );

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
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
      moonshotAdapter.collect(
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

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
  });

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 429, { "Retry-After": "60" }));

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 60_000 },
    });
  });

  test.each([500, 503])("maps HTTP %i to a temporary error", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, status));

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps an unexpected HTTP status to provider changed", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 404));

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
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

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(moonshotAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
