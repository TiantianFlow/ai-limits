import { describe, expect, test } from "vitest";

import type { UsageHistoryObservation } from "./model";
import { balanceAxisMax, balanceHistorySeries } from "./balance-history";

const HOUR = 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 9, 18, 12);

function reading(observedAt: number, value: number, unit = "USD"): UsageHistoryObservation {
  return {
    observedAt,
    metrics: [{ type: "balance", metricId: "balance", value, unit }],
  };
}

describe("balance history", () => {
  test("keeps readings in range and nets the change", () => {
    const series = balanceHistorySeries(
      [
        reading(NOW - 50 * HOUR, 30),
        reading(NOW - 3 * HOUR, 12),
        reading(NOW - 2 * HOUR, 11.5),
        reading(NOW - HOUR, 10),
      ],
      "balance",
      NOW - 48 * HOUR,
      NOW,
    );
    expect(series.points.map((point) => point.value)).toEqual([12, 11.5, 10]);
    expect(series.change).toBe(-2);
    expect(series.topUps).toBe(0);
    expect(series.unit).toBe("USD");
  });

  test("marks a large rise as a top-up but not a rounding blip", () => {
    const series = balanceHistorySeries(
      [
        reading(NOW - 3 * HOUR, 5),
        reading(NOW - 2 * HOUR, 25),
        reading(NOW - HOUR, 25.004),
      ],
      "balance",
      NOW - 48 * HOUR,
      NOW,
    );
    expect(series.points.map((point) => point.topUp)).toEqual([undefined, 20, undefined]);
    expect(series.topUps).toBe(1);
  });

  test("breaks the line across a long silence", () => {
    const series = balanceHistorySeries(
      [reading(NOW - 20 * HOUR, 9), reading(NOW - 19 * HOUR, 8.5), reading(NOW - HOUR, 8)],
      "balance",
      NOW - 48 * HOUR,
      NOW,
    );
    expect(series.runs.map((run) => run.length)).toEqual([2, 1]);
    expect(series.gaps).toEqual([{ start: NOW - 19 * HOUR, end: NOW - HOUR }]);
  });

  test("keeps only the newest reading's currency", () => {
    const series = balanceHistorySeries(
      [reading(NOW - 3 * HOUR, 70, "CNY"), reading(NOW - HOUR, 10, "USD")],
      "balance",
      NOW - 48 * HOUR,
      NOW,
    );
    expect(series.points).toEqual([{ observedAt: NOW - HOUR, value: 10 }]);
    expect(series.change).toBeUndefined();
  });

  test("ignores quota and other balance meters", () => {
    const series = balanceHistorySeries(
      [
        {
          observedAt: NOW - HOUR,
          metrics: [
            { type: "quota", metricId: "balance", usedRatio: 0.5 },
            { type: "balance", metricId: "other", value: 3, unit: "USD" },
          ],
        },
      ],
      "balance",
      NOW - 48 * HOUR,
      NOW,
    );
    expect(series.points).toEqual([]);
  });

  test("rounds the axis top up from the largest balance", () => {
    expect(balanceAxisMax([])).toBe(1);
    expect(balanceAxisMax([0])).toBe(1);
    expect(balanceAxisMax([7.3])).toBe(10);
    expect(balanceAxisMax([18])).toBe(20);
    expect(balanceAxisMax([24])).toBe(25);
    expect(balanceAxisMax([412])).toBe(500);
    expect(balanceAxisMax([100])).toBe(100);
  });
});
