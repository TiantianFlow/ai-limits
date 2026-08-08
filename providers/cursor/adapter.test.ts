import { describe, expect, test, vi } from "vitest";

import { cursorAdapter } from "./adapter";

const NOW = 1_800_000_000_000;
const START = "2030-04-01T00:00:00.000Z";
const END = "2030-05-01T00:00:00.000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(fetch: typeof globalThis.fetch, signal = new AbortController().signal) {
  return { fetch, now: NOW, signal };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    billingCycleStart: START,
    billingCycleEnd: END,
    totalPercentUsed: 0.441025,
    planUsage: { used: 4_410.25, limit: 10_000 },
    onDemandUsage: { used: 320 },
    ...overrides,
  };
}

describe("Cursor adapter", () => {
  test("requests usage and best-effort identity, normalizing percentages, dates, and cents", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(summary()))
      .mockResolvedValueOnce(response({ email: "person@example.com", plan: "Pro" }));

    await expect(cursorAdapter.collect(context(fetch, controller.signal))).resolves.toEqual({
      ok: true,
      snapshot: {
        providerId: "cursor",
        accountLabel: "person@example.com",
        planLabel: "Pro",
        source: "web-session",
        fetchedAt: NOW,
        windows: [
          {
            id: "monthly",
            label: "Monthly usage",
            kind: "calendar",
            usedRatio: 0.00441025,
            startedAt: Date.parse(START),
            resetsAt: Date.parse(END),
            durationMs: Date.parse(END) - Date.parse(START),
            sourceSemantics: "used",
          },
        ],
        credits: [{ id: "on-demand", label: "On-demand spend", unit: "USD", used: 3.2 }],
      },
    });
    const init = {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    };
    expect(fetch).toHaveBeenNthCalledWith(1, "https://cursor.com/api/usage-summary", init);
    expect(fetch).toHaveBeenNthCalledWith(2, "https://cursor.com/api/auth/me", init);
  });

  test("uses an enterprise overall absolute quota when a total percentage is absent", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(summary({ totalPercentUsed: undefined, planUsage: undefined, overallUsage: { used: 250, limit: 1_000 } })))
      .mockResolvedValueOnce(response({}, 500));

    const result = await cursorAdapter.collect(context(fetch));
    expect(result).toMatchObject({ ok: true, snapshot: { windows: [{ usedRatio: 0.25 }] } });
  });

  test("uses a team pooled absolute quota when higher-precedence values are absent", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(summary({ totalPercentUsed: undefined, planUsage: undefined, teamUsage: { used: 100, limit: 400 } })))
      .mockResolvedValueOnce(response({}));

    const result = await cursorAdapter.collect(context(fetch));
    expect(result).toMatchObject({ ok: true, snapshot: { windows: [{ usedRatio: 0.25 }] } });
  });

  test.each([
    ["an out-of-range percentage", summary({ totalPercentUsed: 101 })],
    ["an invalid billing boundary", summary({ billingCycleEnd: "not-a-date" })],
    ["no active quota", summary({ totalPercentUsed: undefined, planUsage: undefined, onDemandUsage: undefined })],
  ])("returns provider_changed for %s", async (_name, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body));
    await expect(cursorAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    [401, "signed_out"],
    [429, "temporary_error"],
    [500, "temporary_error"],
  ] as const)("maps %i to %s", async (status, kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({}, status));
    await expect(cursorAdapter.collect(context(fetch))).resolves.toEqual({ ok: false, health: { kind } });
  });
});
