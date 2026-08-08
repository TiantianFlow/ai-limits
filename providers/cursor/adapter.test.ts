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

function planSummary(overrides: Record<string, unknown> = {}) {
  return {
    billingCycleStart: START,
    billingCycleEnd: END,
    membershipType: "pro",
    individualUsage: {
      plan: {
        enabled: true,
        used: 44.1025,
        limit: 10_000,
        remaining: 9_955.8975,
        autoPercentUsed: 17,
        apiPercentUsed: 100,
        totalPercentUsed: 44.1025,
      },
      onDemand: {
        enabled: true,
        used: 320,
        limit: 1_000,
        remaining: 680,
      },
    },
    ...overrides,
  };
}

describe("Cursor adapter", () => {
  test("requests live usage and renders Cursor and other model pools independently", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary()))
      .mockResolvedValueOnce(response({ email: "person@example.com" }));

    const result = await cursorAdapter.collect(context(fetch, controller.signal));

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerId: "cursor",
        accountLabel: "person@example.com",
        planLabel: "pro",
        source: "web-session",
        fetchedAt: NOW,
        windows: [
          {
            id: "cursor-models-monthly",
            label: "Cursor models",
            kind: "model",
            usedRatio: 0.17,
            startedAt: Date.parse(START),
            resetsAt: Date.parse(END),
            durationMs: Date.parse(END) - Date.parse(START),
            sourceSemantics: "used",
          },
          {
            id: "other-models-monthly",
            label: "Other models",
            kind: "model",
            usedRatio: 1,
            startedAt: Date.parse(START),
            resetsAt: Date.parse(END),
            durationMs: Date.parse(END) - Date.parse(START),
            sourceSemantics: "used",
          },
        ],
        credits: [
          {
            id: "on-demand",
            label: "On-demand spend",
            unit: "USD",
            used: 3.2,
            limit: 10,
          },
        ],
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
    expect(JSON.stringify(result)).not.toContain("autoPercentUsed");
    expect(JSON.stringify(result)).not.toContain("remaining");
  });

  test("keeps a single reported model pool instead of inventing the other", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary({
        individualUsage: {
          plan: {
            enabled: true,
            used: 25,
            limit: 100,
            remaining: 75,
            apiPercentUsed: 60,
          },
        },
      })))
      .mockResolvedValueOnce(response({}));

    await expect(cursorAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          { id: "other-models-monthly", label: "Other models", usedRatio: 0.6 },
        ],
      },
    });
  });

  test("uses the total plan percentage only when no model pool is reported", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary({
        individualUsage: {
          plan: {
            enabled: true,
            used: 40,
            limit: 100,
            remaining: 60,
            totalPercentUsed: 40,
          },
        },
      })))
      .mockResolvedValueOnce(response({}));

    await expect(cursorAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          { id: "monthly", label: "Monthly usage", usedRatio: 0.4 },
        ],
      },
    });
  });

  test("falls back from plan percentages to plan absolute usage", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary({
        individualUsage: {
          plan: { enabled: true, used: 250, limit: 1_000, remaining: 750 },
        },
      })))
      .mockResolvedValueOnce(response({}));

    await expect(cursorAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { windows: [{ usedRatio: 0.25 }] },
    });
  });

  test("uses enterprise overall quota when the plan is disabled", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary({
        membershipType: "enterprise",
        individualUsage: {
          plan: { enabled: false, used: 0, limit: 0, remaining: 0 },
          overall: { enabled: true, used: 250, limit: 1_000, remaining: 750 },
          onDemand: { enabled: false },
        },
      })))
      .mockRejectedValueOnce(new TypeError("identity unavailable"));

    await expect(cursorAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        planLabel: "enterprise",
        windows: [{ usedRatio: 0.25 }],
        credits: [],
      },
    });
  });

  test("uses team pooled quota and team on-demand credit", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({
        billingCycleStart: START,
        billingCycleEnd: END,
        membershipType: "business",
        teamUsage: {
          pooled: { enabled: true, used: 100, limit: 400, remaining: 300 },
          onDemand: { enabled: true, used: 450, limit: 2_000, remaining: 1_550 },
        },
      }))
      .mockResolvedValueOnce(response({ email: "team@example.com" }));

    await expect(cursorAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [{ usedRatio: 0.25 }],
        credits: [{ used: 4.5, limit: 20 }],
      },
    });
  });

  test("lets a clearly present identity plan override membership type", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary()))
      .mockResolvedValueOnce(response({ email: "person@example.com", planName: "Enterprise Plus" }));

    await expect(cursorAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { planLabel: "Enterprise Plus" },
    });
  });

  test.each([
    ["an out-of-range supplied lane", planSummary({
      individualUsage: {
        plan: { enabled: true, totalPercentUsed: 5, autoPercentUsed: 101 },
      },
    })],
    ["inconsistent remaining", planSummary({
      individualUsage: {
        plan: { enabled: true, used: 25, limit: 100, remaining: 50 },
      },
    })],
    ["an invalid billing boundary", planSummary({ billingCycleEnd: "not-a-date" })],
    ["no active quota", planSummary({
      individualUsage: {
        plan: { enabled: false, used: 0, limit: 0, remaining: 0 },
        onDemand: { enabled: true, used: 10 },
      },
    })],
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
    await expect(cursorAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind },
    });
  });
});
