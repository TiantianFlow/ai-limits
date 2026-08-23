import { describe, expect, it, vi } from "vitest";

import type { CollectionContext } from "../types";
import { liteLlmAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_KEY = "sk-synthetic-litellm-key";

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
    baseUrl: "https://litellm.example.com/v1",
    ...overrides,
  };
}

// Observed /key/info envelope from the upstream reference implementation.
function keyInfoFixture(overrides: Record<string, unknown> = {}) {
  return {
    key: "sk-redacted",
    info: {
      key_name: "sk-...IAAw",
      spend: 212.3537162499998,
      expires: "2026-09-11T00:12:55.950000+00:00",
      user_id: "user-123",
      team_id: "team-456",
      max_budget: null,
      ...overrides,
    },
  };
}

describe("LiteLLM adapter", () => {
  it("reads /key/info only and normalizes key spend without inventing a budget", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(keyInfoFixture()));

    const result = await liteLlmAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenCalledWith("https://litellm.example.com/key/info", {
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
        providerKind: "litellm",
        accountLabel: "sk-...IAAw",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "counter",
            id: "key-spend",
            label: "Key spend",
            scope: "product",
            semantic: "spent",
            value: 212.3537162499998,
            unit: "USD",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
    expect(JSON.stringify(result)).not.toContain("sk-redacted");
  });

  it("uses optional max_budget from the observed key-info fixture as a quota", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(keyInfoFixture({ spend: 25, max_budget: 100 })),
    );

    await expect(liteLlmAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          {
            type: "quota",
            id: "key-budget",
            label: "Key budget",
            usedRatio: 0.25,
            used: 25,
            limit: 100,
            unit: "USD",
          },
        ],
      },
    });
  });

  it("labels team-only virtual keys using the observed team-only key-info fixture", async () => {
    // Matches the upstream reference implementation's team-only fixture.
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        info: {
          key_name: "team-service-key",
          spend: 25.0,
          team_id: "team-456",
        },
      }),
    );

    await expect(liteLlmAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        accountLabel: "team-service-key",
        metrics: [{ type: "counter", id: "team-spend", label: "Team spend", value: 25 }],
      },
    });
  });

  it("refuses a missing credential or base URL without making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      liteLlmAdapter.collect(context(fetch, { credential: undefined })),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    await expect(
      liteLlmAdapter.collect(context(fetch, { baseUrl: "http://public.example" })),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, "credential_invalid"],
    [403, "credential_scope_required"],
    [500, "temporary_error"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, status));

    await expect(liteLlmAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });

  it("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({}, 429, { "Retry-After": "120" }));

    await expect(liteLlmAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
  });

  it("maps malformed JSON and a missing info object to provider changed", async () => {
    const broken = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("{broken", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(liteLlmAdapter.collect(context(broken))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });

    const drifted = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ spend: 1 }));
    await expect(liteLlmAdapter.collect(context(drifted))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  it("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(liteLlmAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
