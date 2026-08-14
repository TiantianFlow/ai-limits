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
  test("keeps plan and quota data without requesting the account email", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(planSummary()))
      .mockResolvedValueOnce(response({ email: "person@example.com" }));

    const result = await cursorAdapter.collect(context(fetch, controller.signal));

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "cursor",
        planLabel: "pro",
        source: "web-session",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "cursor-models-monthly",
            label: "Cursor models",
            scope: "model",
            usedRatio: 0.17,
            cycle: { cadence: "calendar", startedAt: Date.parse(START), resetsAt: Date.parse(END), durationMs: Date.parse(END) - Date.parse(START) },
          },
          {
            type: "quota",
            id: "other-models-monthly",
            label: "Other models",
            scope: "model",
            usedRatio: 1,
            cycle: { cadence: "calendar", startedAt: Date.parse(START), resetsAt: Date.parse(END), durationMs: Date.parse(END) - Date.parse(START) },
          },
          {
            type: "counter",
            id: "on-demand",
            label: "On-demand spend",
            scope: "product",
            semantic: "spent",
            unit: "USD",
            value: 3.2,
            limit: 10,
          },
        ],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["cursor-models-monthly", "other-models-monthly", "on-demand"],
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
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("person@example.com");
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
        metrics: [
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
        metrics: [
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
      snapshot: { metrics: [{ usedRatio: 0.25 }] },
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
        metrics: [expect.objectContaining({ type: "quota", usedRatio: 0.25 })],
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
        metrics: [
          expect.objectContaining({ type: "quota", usedRatio: 0.25 }),
          expect.objectContaining({ type: "counter", semantic: "spent", value: 4.5, limit: 20 }),
        ],
      },
    });
  });

  test("omits a non-positive optional on-demand limit", async () => {
    const body = planSummary();
    body.individualUsage.onDemand = {
      enabled: true,
      used: 0,
      limit: 0,
      remaining: 0,
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body));

    const result = await cursorAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "counter",
            id: "on-demand",
            value: 0,
          }),
        ]),
      );
      expect(
        result.snapshot.metrics.find((metric) => metric.id === "on-demand"),
      ).not.toHaveProperty("limit");
    }
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
