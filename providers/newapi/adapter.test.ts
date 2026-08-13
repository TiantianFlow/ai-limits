import { describe, expect, it, vi } from "vitest";

import type { CollectionContext } from "../types";
import { newApiAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_KEY = "sk-synthetic-new-api-key";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(fetch: typeof globalThis.fetch): CollectionContext {
  return {
    fetch,
    now: NOW,
    signal: new AbortController().signal,
    credential: {
      kind: "api-key",
      value: TEST_KEY,
      baseUrl: "https://new-api.example.com/gateway",
    },
  };
}

describe("New API adapter", () => {
  it("validates the instance and normalizes one capped relay key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ success: true, data: { system_name: "Acme AI", version: "1.0.0-rc.24" } }))
      .mockResolvedValueOnce(json({
        code: true,
        message: "ok",
        data: {
          object: "token_usage",
          name: "AI Limits",
          total_granted: 10_000,
          total_used: 2_500,
          total_available: 7_500,
          unlimited_quota: false,
          expires_at: Date.parse("2031-01-01T00:00:00Z") / 1_000,
          model_limits: { "gpt-test": 123 },
        },
      }));

    const result = await newApiAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://new-api.example.com/gateway/api/status",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://new-api.example.com/gateway/api/usage/token/",
      {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${TEST_KEY}` },
        signal: expect.any(AbortSignal),
      },
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerId: "newapi",
        accountLabel: "Acme AI",
        planLabel: "AI Limits",
        source: "api-key",
        fetchedAt: NOW,
        windows: [{
          id: "relay-key-quota",
          label: "API key quota",
          kind: "feature",
          usedRatio: 0.25,
          used: 2_500,
          limit: 10_000,
          unit: "quota units",
          sourceSemantics: "used",
        }],
        credits: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
    expect(JSON.stringify(result)).not.toContain("gpt-test");
    expect(JSON.stringify(result)).not.toContain("2031");
  });

  it("shows absolute usage without inventing a percentage for an unlimited key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ success: true, data: { system_name: "New API" } }))
      .mockResolvedValueOnce(json({
        code: true,
        data: {
          name: "Unlimited",
          total_granted: 0,
          total_used: 42_000,
          total_available: 0,
          unlimited_quota: true,
          expires_at: 0,
        },
      }));

    const result = await newApiAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        windows: [],
        credits: [{
          id: "relay-key-usage",
          label: "API key usage",
          unit: "quota units",
          used: 42_000,
        }],
      },
    });
  });

  it.each([
    [401, "credential_invalid"],
    [403, "credential_scope_required"],
    [429, "temporary_error"],
    [500, "temporary_error"],
  ] as const)("maps usage status %s to %s", async (status, kind) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ success: true, data: { system_name: "New API" } }))
      .mockResolvedValueOnce(json({}, status));

    await expect(newApiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });

  it("distinguishes a non-New-API site from a temporarily unavailable instance", async () => {
    const invalidSiteFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({ product: "something else" }),
    );
    await expect(newApiAdapter.collect(context(invalidSiteFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(invalidSiteFetch).toHaveBeenCalledTimes(1);

    const offlineFetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    await expect(newApiAdapter.collect(context(offlineFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  it("treats an authenticated or incompatible status endpoint as the wrong site", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, 401));

    await expect(newApiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or contradictory usage instead of inventing data", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ success: true, data: { system_name: "New API" } }))
      .mockResolvedValueOnce(json({
        code: true,
        data: {
          name: "Broken",
          total_granted: 100,
          total_used: 90,
          total_available: 50,
          unlimited_quota: false,
        },
      }));

    await expect(newApiAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });
});
