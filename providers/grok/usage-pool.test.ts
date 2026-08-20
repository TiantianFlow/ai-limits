import { describe, expect, test } from "vitest";

import { inspectUsagePool, normalizeUsagePool } from "./usage-pool";

const WEEKLY_END = Date.parse("2026-08-24T00:00:00.000Z");
const WEEKLY_START = Date.parse("2026-08-17T00:00:00.000Z");

function weeklyCamel(overrides: Record<string, unknown> = {}) {
  return {
    creditUsagePercent: 42,
    currentPeriod: {
      type: "WEEKLY",
      start: "2026-08-17T00:00:00.000Z",
      end: "2026-08-24T00:00:00.000Z",
    },
    onDemand: { remaining: 9 },
    prepaid: { remaining: 3 },
    ...overrides,
  };
}

describe("normalizeUsagePool", () => {
  test("maps a camelCase weekly config to a calendar weekly-pool metric", () => {
    expect(normalizeUsagePool(weeklyCamel())).toEqual({
      type: "quota",
      id: "weekly-pool",
      label: "Weekly usage pool",
      scope: "general",
      usedRatio: 0.42,
      cycle: {
        cadence: "calendar",
        startedAt: WEEKLY_START,
        resetsAt: WEEKLY_END,
        durationMs: WEEKLY_END - WEEKLY_START,
      },
    });
  });

  test("maps a snake_case monthly config and ignores product usage fields", () => {
    const metric = normalizeUsagePool({
      credit_usage_percent: 10,
      current_period: {
        type: "MONTHLY",
        start: "2026-08-01T00:00:00.000Z",
        end: "2026-09-01T00:00:00.000Z",
      },
      product_usage: { tokens: 12 },
    });

    expect(metric).toMatchObject({
      id: "monthly-pool",
      label: "Monthly usage pool",
      usedRatio: 0.1,
      cycle: { cadence: "calendar" },
    });
    expect(metric).not.toHaveProperty("used");
    expect(metric).not.toHaveProperty("limit");
    expect(JSON.stringify(metric)).not.toContain("product_usage");
    expect(JSON.stringify(metric)).not.toContain("onDemand");
  });

  test("accepts wrapped A/B envelopes and proto period names", () => {
    expect(
      normalizeUsagePool({
        config: {
          creditUsagePercent: 0,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            end: { seconds: WEEKLY_END / 1_000, nanos: 0 },
          },
        },
      }),
    ).toMatchObject({
      id: "weekly-pool",
      usedRatio: 0,
      cycle: { cadence: "calendar", resetsAt: WEEKLY_END },
    });

    expect(
      normalizeUsagePool({
        grokCreditsConfig: {
          credit_usage_percent: 100,
          current_period: {
            type: 1,
            end: String(WEEKLY_END),
          },
        },
      }),
    ).toMatchObject({
      id: "monthly-pool",
      usedRatio: 1,
      cycle: { cadence: "calendar", resetsAt: WEEKLY_END },
    });
  });

  test("classifies disabled, empty, and flag-missing payloads as absent", () => {
    expect(inspectUsagePool({})).toEqual({
      kind: "absent",
      reason: "flag_missing",
    });
    expect(inspectUsagePool({ code: 5, message: "not found" })).toEqual({
      kind: "absent",
      reason: "flag_missing",
    });
    expect(inspectUsagePool({ isUnifiedBillingUser: true })).toEqual({
      kind: "absent",
      reason: "empty",
    });
    expect(
      inspectUsagePool({
        isUnifiedBillingUser: false,
        ...weeklyCamel(),
      }),
    ).toEqual({ kind: "absent", reason: "disabled" });
    expect(
      inspectUsagePool({
        is_unified_billing_user: false,
        config: weeklyCamel(),
      }),
    ).toEqual({ kind: "absent", reason: "disabled" });
  });

  test("names the exact field when 200 JSON does not parse", () => {
    expect(inspectUsagePool(weeklyCamel({ creditUsagePercent: 101 }))).toEqual({
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has out-of-range field: credit_usage_percent",
    });
    expect(inspectUsagePool(weeklyCamel({ creditUsagePercent: -1 }))).toEqual({
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has out-of-range field: credit_usage_percent",
    });
    expect(
      inspectUsagePool(weeklyCamel({ creditUsagePercent: Number.NaN })),
    ).toEqual({
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has non-finite field: credit_usage_percent",
    });
    expect(
      inspectUsagePool({
        creditUsagePercent: 10,
        currentPeriod: { type: "WEEKLY" },
      }),
    ).toEqual({
      kind: "unparseable",
      message:
        "Grok usage-pool JSON missing required field: current_period.end",
    });
    expect(
      inspectUsagePool(weeklyCamel({ currentPeriod: { type: "DAILY", end: "2026-08-24T00:00:00.000Z" } })),
    ).toEqual({
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has unrecognized field: current_period.type",
    });
    expect(
      inspectUsagePool({
        current_period: {
          type: "WEEKLY",
          end: "2026-08-24T00:00:00.000Z",
        },
      }),
    ).toEqual({
      kind: "unparseable",
      message:
        "Grok usage-pool JSON missing required field: credit_usage_percent",
    });
  });

  test("keeps resetsAt without inventing duration when start is missing or inverted", () => {
    expect(
      normalizeUsagePool({
        creditUsagePercent: 25,
        currentPeriod: {
          type: "WEEKLY",
          end: "2026-08-24T00:00:00.000Z",
        },
      }),
    ).toEqual({
      type: "quota",
      id: "weekly-pool",
      label: "Weekly usage pool",
      scope: "general",
      usedRatio: 0.25,
      cycle: {
        cadence: "calendar",
        resetsAt: WEEKLY_END,
      },
    });

    const inverted = normalizeUsagePool({
      creditUsagePercent: 25,
      currentPeriod: {
        type: "WEEKLY",
        start: "2026-08-24T00:00:00.000Z",
        end: "2026-08-17T00:00:00.000Z",
      },
    });
    expect(inverted?.cycle).toEqual({
      cadence: "calendar",
      resetsAt: WEEKLY_START,
    });
  });
});
