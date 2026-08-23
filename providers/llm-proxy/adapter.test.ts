import { describe, expect, it, vi } from "vitest";

import type { CollectionContext } from "../types";
import { llmProxyAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_KEY = "sk-synthetic-llm-proxy-key";

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
    baseUrl: "https://proxy.example.com",
    ...overrides,
  };
}

// Observed /v1/quota-stats payload from the upstream reference implementation.
function quotaStatsFixture(overrides: Record<string, unknown> = {}) {
  return {
    providers: {
      openai: {
        credential_count: 3,
        active_count: 2,
        exhausted_count: 1,
        total_requests: 120,
        tokens: {
          input_cached: 1000,
          input_uncached: 2000,
          output: 3000,
        },
        approx_cost: 12.5,
        quota_groups: {
          default: {
            remaining_percent: 42,
            reset_time: "2030-05-18T12:00:00Z",
          },
        },
      },
      anthropic: {
        credential_count: 1,
        active_count: 1,
        exhausted_count: 0,
        total_requests: 40,
        tokens: {
          input_cached: 0,
          input_uncached: 500,
          output: 500,
        },
        approx_cost: 3.0,
        quota_groups: [{ remaining_percent: 80 }],
      },
    },
    summary: {
      total_requests: 160,
      total_tokens: 7000,
      approx_cost: 15.5,
    },
    ...overrides,
  };
}

describe("LLM Proxy adapter", () => {
  it("reads /v1/quota-stats and maps the lowest remaining percent to used ratio", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(quotaStatsFixture()));

    const result = await llmProxyAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenCalledWith("https://proxy.example.com/v1/quota-stats", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TEST_KEY}`,
      },
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        providerKind: "llmProxy",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "remaining-quota",
            label: "Remaining quota",
            scope: "product",
            cycle: { resetsAt: Date.parse("2030-05-18T12:00:00.000Z") },
          },
        ],
      },
    });
    if (result.ok) {
      const quota = result.snapshot.metrics[0];
      expect(quota?.type).toBe("quota");
      if (quota?.type === "quota") {
        expect(quota.usedRatio).toBeCloseTo(0.58);
      }
    }
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it("falls back to request and token counters when no remaining percent is present", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        providers: {
          openai: {
            total_requests: 9,
            tokens: { input_cached: 1, input_uncached: 2, output: 3 },
          },
        },
        summary: { total_requests: 9, total_tokens: 6 },
      }),
    );

    await expect(llmProxyAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { type: "counter", id: "total-requests", value: 9, unit: "requests" },
          { type: "counter", id: "total-tokens", value: 6, unit: "tokens" },
        ],
      },
    });
  });

  it("ignores already-elapsed reset times from the observed fractional-second fixture", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        providers: {
          openai: {
            quota_groups: [
              {
                remaining_percent: 42,
                reset_time: "2026-05-18T12:00:00.123Z",
              },
            ],
          },
        },
      }),
    );

    const result = await llmProxyAdapter.collect(context(fetch));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.metrics[0]).toMatchObject({ id: "remaining-quota" });
      expect(result.snapshot.metrics[0]).not.toHaveProperty("cycle");
    }
  });

  it.each([
    [401, "credential_invalid"],
    [403, "credential_scope_required"],
    [500, "temporary_error"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, status));

    await expect(llmProxyAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });

  it("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({}, 429, { "Retry-After": "45" }));

    await expect(llmProxyAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 45_000 },
    });
  });

  it("maps a missing providers object to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ summary: {} }));

    await expect(llmProxyAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  it("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(llmProxyAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
