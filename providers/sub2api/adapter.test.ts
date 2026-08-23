import { describe, expect, it, vi } from "vitest";

import type { CollectionContext } from "../types";
import { sub2apiAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_KEY = "sk-synthetic-sub2api-key";

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
    baseUrl: "https://sub2api.example.com",
    ...overrides,
  };
}

// Field names follow the upstream reference implementation.
function quotaFixture(overrides: Record<string, unknown> = {}) {
  return {
    mode: "quota",
    isValid: true,
    planName: "Group key",
    unit: "USD",
    quota: { limit: 100, used: 25, remaining: 75, unit: "USD" },
    rate_limits: [
      {
        window: "5h",
        limit: 10,
        used: 2,
        remaining: 8,
        reset_at: "2030-04-15T17:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("sub2api adapter", () => {
  it("requests /v1/usage with a 30-day UTC window and maps quota plus rate limits", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(quotaFixture()));

    const result = await sub2apiAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenCalledWith(
      "https://sub2api.example.com/v1/usage?days=30&timezone=UTC",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${TEST_KEY}`,
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "sub2api",
        planLabel: "Group key",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "key-quota",
            label: "Key quota",
            scope: "feature",
            usedRatio: 0.25,
            used: 25,
            limit: 100,
            unit: "USD",
          },
          {
            type: "quota",
            id: "rate-5h",
            label: "5 hour limit",
            scope: "feature",
            usedRatio: 0.2,
            used: 2,
            limit: 10,
            unit: "USD",
            cycle: {
              cadence: "rolling",
              durationMs: 300 * 60 * 1_000,
              resetsAt: Date.parse("2030-04-15T17:00:00.000Z"),
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it("maps subscription windows when the key is in subscription mode", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        subscription: {
          daily_usage_usd: 1,
          daily_limit_usd: 4,
          weekly_usage_usd: 5,
          weekly_limit_usd: 20,
          monthly_usage_usd: 12,
          monthly_limit_usd: 40,
        },
      }),
    );

    const result = await sub2apiAdapter.collect(context(fetch));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.metrics.map((metric) => metric.id)).toEqual([
        "daily",
        "weekly",
        "monthly",
      ]);
    }
  });

  it("maps a bare wallet balance for an unlimited key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ balance: 18.5, unit: "USD" }));

    await expect(sub2apiAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [{ type: "balance", id: "balance", value: 18.5, unit: "USD" }],
      },
    });
  });

  it("treats isValid false as an invalid credential", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(quotaFixture({ isValid: false })));

    await expect(sub2apiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
  });

  it("accepts loopback HTTP the same way New API does", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(quotaFixture()));

    await sub2apiAdapter.collect(context(fetch, { baseUrl: "http://127.0.0.1:8080/v1" }));

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/usage?days=30&timezone=UTC",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    [401, "credential_invalid"],
    [403, "credential_scope_required"],
    [500, "temporary_error"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, status));

    await expect(sub2apiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });

  it("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({}, 429, { "Retry-After": "15" }));

    await expect(sub2apiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 15_000 },
    });
  });

  it("maps a non-object quota payload to provider changed", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ quota: "unlimited" }));

    await expect(sub2apiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  it("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(sub2apiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
