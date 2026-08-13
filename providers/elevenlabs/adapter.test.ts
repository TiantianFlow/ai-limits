import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { elevenLabsAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-test-credential";
const MAY_RESET_SECONDS = Date.parse("2030-05-01T00:00:00.000Z") / 1_000;

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

function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    tier: "starter",
    character_count: 2_500,
    character_limit: 10_000,
    next_character_count_reset_unix: MAY_RESET_SECONDS,
    character_refresh_period: "monthly_period",
    voice_slots_used: 2,
    voice_limit: 10,
    professional_voice_slots_used: 9,
    professional_voice_slots_used_in_workspace: 1,
    professional_voice_limit: 3,
    voice_add_edit_counter: 4,
    max_voice_add_edits: 20,
    current_overage: { amount: "excluded-overage-sentinel", currency: "usd" },
    open_invoices: [{ payment_intent_status: "excluded-payment-sentinel" }],
    next_invoice: { discounts: [{ coupon: "excluded-coupon-sentinel" }] },
    ...overrides,
  };
}

describe("ElevenLabs adapter", () => {
  test("requests the subscription with only the API key and normalizes documented limits", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(subscriptionFixture()));

    const result = await elevenLabsAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/user/subscription",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "xi-api-key": TEST_CREDENTIAL,
        },
        signal: controller.signal,
      },
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerId: "elevenlabs",
        planLabel: "starter",
        source: "api-key",
        fetchedAt: NOW,
        windows: [
          {
            id: "monthly-credits",
            label: "Monthly credits",
            kind: "calendar",
            usedRatio: 0.25,
            used: 2_500,
            limit: 10_000,
            unit: "credits",
            startedAt: Date.parse("2030-04-01T00:00:00.000Z"),
            resetsAt: Date.parse("2030-05-01T00:00:00.000Z"),
            durationMs: 30 * 24 * 60 * 60 * 1_000,
            sourceSemantics: "used",
          },
          {
            id: "voice-slots",
            label: "Voice slots",
            kind: "feature",
            usedRatio: 0.2,
            used: 2,
            limit: 10,
            unit: "voices",
            sourceSemantics: "used",
          },
          {
            id: "professional-voice-slots",
            label: "Professional voice slots",
            kind: "feature",
            usedRatio: 1 / 3,
            used: 1,
            limit: 3,
            unit: "voices",
            sourceSemantics: "used",
          },
          {
            id: "voice-add-edits",
            label: "Voice add/edits",
            kind: "feature",
            usedRatio: 0.2,
            used: 4,
            limit: 20,
            unit: "actions",
            sourceSemantics: "used",
          },
        ],
        credits: [],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TEST_CREDENTIAL);
    expect(serialized).not.toContain("excluded-overage-sentinel");
    expect(serialized).not.toContain("excluded-payment-sentinel");
    expect(serialized).not.toContain("excluded-coupon-sentinel");
  });

  test("prefers an explicit valid last credit reset over calendar derivation", async () => {
    const nextReset = Date.parse("2030-05-31T16:11:00.000Z") / 1_000;
    const lastReset = Date.parse("2030-04-28T09:30:00.000Z") / 1_000;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          next_character_count_reset_unix: nextReset,
          last_character_count_reset_unix: lastReset,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(
      context(fetch, { now: Date.parse("2030-05-01T12:00:00.000Z") }),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(
        result.snapshot.windows.find(({ id }) => id === "monthly-credits"),
      ).toMatchObject({
        startedAt: lastReset * 1_000,
        resetsAt: nextReset * 1_000,
        durationMs: (nextReset - lastReset) * 1_000,
      });
    }
  });

  test("clamps a derived monthly boundary to the previous month end", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          next_character_count_reset_unix:
            Date.parse("2030-03-31T16:11:00.000Z") / 1_000,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(
      context(fetch, { now: Date.parse("2030-03-15T12:00:00.000Z") }),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.windows[0]).toMatchObject({
        startedAt: Date.parse("2030-02-28T16:11:00.000Z"),
        resetsAt: Date.parse("2030-03-31T16:11:00.000Z"),
      });
    }
  });

  test("derives an annual boundary with leap-day clamping", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          next_character_count_reset_unix:
            Date.parse("2032-02-29T08:45:00.000Z") / 1_000,
          character_refresh_period: "annual_period",
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(
      context(fetch, { now: Date.parse("2031-08-15T12:00:00.000Z") }),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.windows[0]).toMatchObject({
        startedAt: Date.parse("2031-02-28T08:45:00.000Z"),
        resetsAt: Date.parse("2032-02-29T08:45:00.000Z"),
      });
    }
  });

  test("does not invent a calendar start for an unrecognized refresh period", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(subscriptionFixture({ character_refresh_period: "weekly_period" })),
    );

    const result = await elevenLabsAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const monthly = result.snapshot.windows[0];
      expect(monthly).toMatchObject({
        id: "monthly-credits",
        resetsAt: MAY_RESET_SECONDS * 1_000,
      });
      expect(monthly).not.toHaveProperty("startedAt");
      expect(monthly).not.toHaveProperty("durationMs");
    }
  });

  test("omits an out-of-range reset timestamp that cannot form a valid Date", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          next_character_count_reset_unix: 10_000_000_000_000,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const monthly = result.snapshot.windows[0];
      expect(monthly).toMatchObject({ id: "monthly-credits" });
      expect(monthly).not.toHaveProperty("startedAt");
      expect(monthly).not.toHaveProperty("resetsAt");
      expect(monthly).not.toHaveProperty("durationMs");
    }
  });

  test("falls back from an out-of-range explicit last reset to calendar derivation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          last_character_count_reset_unix: 10_000_000_000_000,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.windows[0]).toMatchObject({
        id: "monthly-credits",
        startedAt: Date.parse("2030-04-01T00:00:00.000Z"),
        resetsAt: Date.parse("2030-05-01T00:00:00.000Z"),
      });
    }
  });

  test("omits a temporally impossible stale next reset while preserving quota", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          next_character_count_reset_unix:
            Date.parse("2030-04-01T00:00:00.000Z") / 1_000,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const monthly = result.snapshot.windows[0];
      expect(monthly).toMatchObject({
        id: "monthly-credits",
        used: 2_500,
        limit: 10_000,
      });
      expect(monthly).not.toHaveProperty("startedAt");
      expect(monthly).not.toHaveProperty("resetsAt");
      expect(monthly).not.toHaveProperty("durationMs");
    }
  });

  test("omits a temporally impossible future explicit start while preserving quota", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          last_character_count_reset_unix:
            Date.parse("2030-04-20T00:00:00.000Z") / 1_000,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const monthly = result.snapshot.windows[0];
      expect(monthly).toMatchObject({
        id: "monthly-credits",
        used: 2_500,
        limit: 10_000,
      });
      expect(monthly).not.toHaveProperty("startedAt");
      expect(monthly).not.toHaveProperty("resetsAt");
      expect(monthly).not.toHaveProperty("durationMs");
    }
  });

  test("omits absent optional capacity limits while keeping monthly credits", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          voice_slots_used: undefined,
          voice_limit: undefined,
          professional_voice_slots_used: undefined,
          professional_voice_slots_used_in_workspace: undefined,
          professional_voice_limit: undefined,
          voice_add_edit_counter: undefined,
          max_voice_add_edits: undefined,
        }),
      ),
    );

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { windows: [{ id: "monthly-credits" }] },
    });
  });

  test("preserves valid zero usage for every documented capacity", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          character_count: 0,
          voice_slots_used: 0,
          professional_voice_slots_used_in_workspace: 0,
          voice_add_edit_counter: 0,
        }),
      ),
    );

    const result = await elevenLabsAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.windows.map(({ id, used, usedRatio }) => ({
        id,
        used,
        usedRatio,
      }))).toEqual([
        { id: "monthly-credits", used: 0, usedRatio: 0 },
        { id: "voice-slots", used: 0, usedRatio: 0 },
        { id: "professional-voice-slots", used: 0, usedRatio: 0 },
        { id: "voice-add-edits", used: 0, usedRatio: 0 },
      ]);
    }
  });

  test("omits zero optional limits instead of emitting invalid windows", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          voice_limit: 0,
          professional_voice_limit: 0,
          max_voice_add_edits: 0,
        }),
      ),
    );

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { windows: [{ id: "monthly-credits" }] },
    });
  });

  test("omits impossible used values while preserving an independent valid limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        subscriptionFixture({
          character_count: 10_001,
          voice_slots_used: 2,
          voice_limit: 10,
          professional_voice_slots_used_in_workspace: 4,
          voice_add_edit_counter: 21,
          max_voice_add_edits: 20,
          professional_voice_limit: 3,
        }),
      ),
    );

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [{ id: "voice-slots", used: 2, limit: 10 }],
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["missing", undefined],
    ["wrong kind", { kind: "browser-session", value: TEST_CREDENTIAL }],
    ["blank", { kind: "api-key", value: "   " }],
  ])("refuses a %s credential without making a request", async (_name, credential) => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      elevenLabsAdapter.collect(
        context(fetch, {
          credential: credential as CollectionContext["credential"],
        }),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    [401, "credential_invalid"],
    [403, "credential_scope_required"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, status));

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 429, { "Retry-After": "120" }));

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
  });

  test.each([500, 503])("maps HTTP %i to a temporary error", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, status));

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
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

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("maps a successful response with schema drift to provider changed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(subscriptionFixture({ character_count: "2500" })),
    );

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(elevenLabsAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps an aborted request to a temporary error", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Synthetic timeout", "AbortError"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(controller.signal.reason);

    await expect(
      elevenLabsAdapter.collect(context(fetch, { signal: controller.signal })),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
