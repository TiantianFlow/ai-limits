import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { deepInfraAdapter } from "./adapter";

// Fixtures mirror the wire shapes decoded by the upstream reference
// implementation. Checklist money is USD; `total_cost` in the usage response
// is cents.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-test-credential";
const CHECKLIST_URL = "https://api.deepinfra.com/payment/checklist?compute_owed=true";
const USAGE_URL = "https://api.deepinfra.com/payment/usage?from=current";

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

function checklistFixture(overrides: Record<string, unknown> = {}) {
  return {
    stripe_balance: -12.34,
    recent: 2.5,
    limit: 50,
    suspended: false,
    suspend_reason: null,
    ...overrides,
  };
}

function usageFixture(overrides: Record<string, unknown> = {}) {
  return {
    months: [
      { period: "2030-03", total_cost: 1_000 },
      { period: "2030-04", total_cost: 1_250 },
    ],
    initial_month: "2030-01",
    ...overrides,
  };
}

function sequencedFetch(
  checklist: Response,
  usage: Response,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(checklist)
    .mockResolvedValueOnce(usage);
}

describe("DeepInfra adapter", () => {
  test("requests checklist then usage and emits a spending-limit quota", async () => {
    const controller = new AbortController();
    const fetch = sequencedFetch(
      response(checklistFixture()),
      response(usageFixture()),
    );

    const result = await deepInfraAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    const expectedHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${TEST_CREDENTIAL}`,
    };
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, CHECKLIST_URL, {
      method: "GET",
      headers: expectedHeaders,
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenNthCalledWith(2, USAGE_URL, {
      method: "GET",
      headers: expectedHeaders,
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "deepinfra",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "spending-limit",
            label: "Spending limit",
            scope: "product",
            usedRatio: 12.5 / 50,
            used: 12.5,
            limit: 50,
            unit: "USD",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("clamps a negative current-month cost to zero", async () => {
    const fetch = sequencedFetch(
      response(checklistFixture()),
      response(
        usageFixture({
          months: [{ period: "2030-04", total_cost: -500 }],
        }),
      ),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [{ id: "spending-limit", used: 0, usedRatio: 0 }],
      },
    });
  });

  test("falls back to checklist recent spend when months is empty", async () => {
    const fetch = sequencedFetch(
      response(checklistFixture({ recent: 4.2 })),
      response(usageFixture({ months: [] })),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [{ id: "spending-limit", used: 4.2, limit: 50 }],
      },
    });
  });

  test.each([
    ["absent", { limit: undefined }],
    ["null", { limit: null }],
    ["zero", { limit: 0 }],
  ])(
    "emits a stripe balance when the spending limit is %s",
    async (_name, override) => {
      const fetch = sequencedFetch(
        response(checklistFixture(override)),
        response(usageFixture()),
      );

      await expect(deepInfraAdapter.collect(context(fetch))).resolves.toMatchObject({
        ok: true,
        snapshot: {
          metrics: [
            { type: "balance", id: "balance", value: -12.34, unit: "USD" },
          ],
        },
      });
    },
  );

  test("maps a missing stripe balance without a limit to provider changed", async () => {
    const fetch = sequencedFetch(
      response({ recent: 1, limit: 0, suspended: false }),
      response(usageFixture()),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps malformed checklist JSON to provider changed", async () => {
    const fetch = sequencedFetch(
      new Response("{broken", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      response(usageFixture()),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("maps a string-typed usage cost to provider changed", async () => {
    const fetch = sequencedFetch(
      response(checklistFixture()),
      response(
        usageFixture({
          months: [{ period: "2030-04", total_cost: "1250" }],
        }),
      ),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    ["checklist", 0],
    ["usage", 1],
  ])(
    "maps HTTP 401 on the %s call to credential invalid",
    async (_name, failureIndex) => {
      const responses = [
        response(checklistFixture()),
        response(usageFixture()),
      ];
      responses[failureIndex] = response({}, 401);
      const fetch = sequencedFetch(responses[0]!, responses[1]!);

      await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
        ok: false,
        health: { kind: "credential_invalid" },
      });
    },
  );

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = sequencedFetch(
      response({}, 429, { "Retry-After": "90" }),
      response(usageFixture()),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 90_000 },
    });
  });

  test("maps HTTP 500 on the usage call to a temporary error", async () => {
    const fetch = sequencedFetch(
      response(checklistFixture()),
      response({}, 500),
    );

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
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
      deepInfraAdapter.collect(
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

    await expect(deepInfraAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
