import { describe, expect, it, vi } from "vitest";

import type { CollectionContext } from "../types";
import { CLAWROUTER_DEFAULT_BASE_URL, clawRouterAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_KEY = "sk-synthetic-clawrouter-key";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
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
    credential: { kind: "api-key", value: TEST_KEY },
    baseUrl: "https://clawrouter.openclaw.ai",
    ...overrides,
  };
}

// Fields required by the upstream reference implementation.
function usageFixture(overrides: Record<string, unknown> = {}) {
  return {
    budget: {
      configured: true,
      ledger: "policy-ledger",
      limitMicros: 10_000_000,
      spentMicros: 2_500_000,
      remainingMicros: 7_500_000,
      windowKey: "2026-04",
    },
    usage: {
      summary: {
        requestCount: 12,
        successCount: 10,
        errorCount: 2,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        actualCostMicros: 1_250_000,
      },
      providers: [
        {
          provider: "openai",
          requestCount: 8,
          successCount: 7,
          errorCount: 1,
          totalTokens: 100,
          actualCostMicros: 1_000_000,
        },
      ],
    },
    ...overrides,
  };
}

describe("ClawRouter adapter", () => {
  it("reads /v1/usage and maps a configured monthly budget to remaining balance", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(usageFixture()));

    const result = await clawRouterAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenCalledWith(`${CLAWROUTER_DEFAULT_BASE_URL}/v1/usage`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TEST_KEY}`,
      },
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "clawrouter",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "balance",
            id: "monthly-budget",
            label: "Monthly budget",
            scope: "product",
            value: 7.5,
            unit: "USD",
            initialLimit: 10,
            cycle: {
              cadence: "calendar",
              resetsAt: Date.parse("2026-05-01T00:00:00.000Z"),
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it("falls back to actualCostMicros when the policy is unmetered", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(
        usageFixture({
          budget: { configured: false, ledger: "unmetered" },
        }),
      ),
    );

    await expect(clawRouterAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          {
            type: "counter",
            id: "actual-cost",
            semantic: "spent",
            value: 1.25,
            unit: "USD",
          },
        ],
      },
    });
  });

  it("defaults to the hosted origin when no base URL is configured", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(usageFixture()));

    await clawRouterAdapter.collect(context(fetch, { baseUrl: undefined }));

    expect(fetch).toHaveBeenCalledWith(
      `${CLAWROUTER_DEFAULT_BASE_URL}/v1/usage`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    [401, "credential_invalid"],
    [403, "credential_scope_required"],
    [500, "temporary_error"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, status));

    await expect(clawRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });

  it("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({}, 429, { "Retry-After": "30" }));

    await expect(clawRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 30_000 },
    });
  });

  it("maps a missing budget object to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({ usage: usageFixture().usage }),
    );

    await expect(clawRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  it("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(clawRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
