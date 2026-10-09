import { describe, expect, it } from "vitest";

import { buildChartModel, paceLine, segmentStyle, wholePercent } from "./history-v20";
import type { UsageHistoryObservation } from "./model";

const HOUR = 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 9, 8, 18, 0, 0);

function reading(at: number, used: number, resetsAt: number, durationMs = 5 * HOUR): UsageHistoryObservation {
  return {
    observedAt: at,
    metrics: [{
      type: "quota",
      metricId: "five-hour",
      usedRatio: used / 100,
      cycle: { cadence: "rolling", durationMs, resetsAt },
    }],
  };
}

describe("history v20 drawing", () => {
  it("draws a solid segment when the values are equal or the segment is at most 12px", () => {
    const pxPerMs = 13 / HOUR;
    expect(segmentStyle(HOUR, 0, pxPerMs)).toBe("known");
    expect(segmentStyle(HOUR, 20, 12 / HOUR)).toBe("known");
    expect(segmentStyle(2 * HOUR, 20, 13 / HOUR)).toBe("estimated");
  });

  it("holds the last reading with a dashed line out to the reset", () => {
    const start = NOW - 4 * HOUR;
    const history = [reading(start + HOUR, 20, NOW + HOUR)];
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    const run = model.runs[0];
    expect(run).toBeDefined();
    expect(run!.styles.at(-1)).toBe("estimated");
    expect(run!.points.at(-1)?.at).toBe(NOW);
    expect(run!.points.at(-1)?.used).toBeCloseTo(20, 5);
  });

  it("drops to zero at a reset that has already happened", () => {
    const end = NOW - 2 * HOUR;
    const history = [reading(end - 3 * HOUR, 40, end)];
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      providerKind: "claude",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    const run = model.runs[0];
    expect(run!.points.at(-1)?.used).toBe(0);
    expect(run!.points.at(-1)?.at).toBe(end);
    expect(run!.styles.at(-1)).toBe("known");
    expect(run!.styles.at(-2)).toBe("estimated");
  });

  it("carries a window that started before the range in from the left edge", () => {
    const end = NOW + 2 * HOUR;
    const history = [
      reading(NOW - 60 * HOUR, 10, end, 72 * HOUR),
      reading(NOW - 2 * HOUR, 50, end, 72 * HOUR),
    ];
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      providerKind: "claude",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    const run = model.runs[0];
    expect(run!.points[0]?.at).toBe(NOW - 48 * HOUR);
    expect(run!.points[0]?.used).toBeGreaterThan(10);
    expect(run!.points[0]?.used).toBeLessThan(50);
  });

  it("draws a window that stays at 0% as idle, not as a usage run", () => {
    const end = NOW + 2 * HOUR;
    const history = [reading(NOW - HOUR, 0, end)];
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      providerKind: "claude",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    expect(model.runs).toHaveLength(0);
    expect(model.idle.some((span) => span.reason === "no-usage" || span.reason === "no-window")).toBe(true);
  });

  it("lifts a short bar to the minimum and leaves no hole between Left notches", () => {
    const history: UsageHistoryObservation[] = [];
    for (let index = 0; index < 30; index += 1) {
      const end = NOW - index * 5 * HOUR;
      history.push(reading(end - 4 * HOUR, index % 5 === 0 ? 0 : 2, end));
    }
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      providerKind: "claude",
      now: NOW,
      rangeStart: NOW - 30 * 24 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    expect(model.tier).not.toBe("line");
    expect(model.bars.length).toBeGreaterThan(0);
    const plot = 82;
    for (const bar of model.bars) {
      if (bar.peak <= 0) continue;
      const depth = Math.max(3, (bar.peak / 100) * plot);
    expect(depth).toBeGreaterThanOrEqual(3);
    }
    const notches = model.bars.filter((bar) => bar.peak > 0).map((bar) => [bar.start, bar.end] as [number, number]);
    for (let index = 1; index < notches.length; index += 1) {
      expect(notches[index - 1]![1]).toBeLessThanOrEqual(notches[index]![0]);
    }
  });

  it("does not mark a gap under the axis where the idle line already covers the stretch", () => {
    const history: UsageHistoryObservation[] = [];
    for (let index = 0; index < 20; index += 1) {
      const end = NOW - index * 6 * HOUR;
      history.push(reading(end - 4 * HOUR, index % 3 === 0 ? 0 : 8, end));
    }
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      providerKind: "claude",
      now: NOW,
      rangeStart: NOW - 7 * 24 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    expect(model.tier).not.toBe("line");
    expect(model.idle.length).toBeGreaterThan(0);
    const overlaps = (gap: { start: number; end: number }): boolean =>
      model.idle.some((span) => Math.min(gap.end, span.end) - Math.max(gap.start, span.start) > HOUR);
    expect(model.gaps.filter(overlaps)).toEqual([]);
  });

  it("keeps idle between the bars rather than one span across the chart", () => {
    const history = [
      reading(NOW - 40 * HOUR, 30, NOW - 36 * HOUR),
      reading(NOW - 4 * HOUR, 10, NOW),
    ];
    const model = buildChartModel({
      history,
      metricId: "five-hour",
      providerKind: "claude",
      now: NOW,
      rangeStart: NOW - 30 * 24 * HOUR,
      rangeEnd: NOW,
      widthPx: 360,
    });
    expect(model.idle.every((span) => span.end - span.start < 30 * 24 * HOUR)).toBe(true);
  });
});

describe("history v20 pace", () => {
  const start = NOW - 10 * HOUR;
  const resets = NOW + 10 * HOUR;

  it("names only the reset before 15% of the window has elapsed", () => {
    const young = paceLine({
      currentUsed: 20,
      windowStart: NOW - HOUR,
      resetsAt: NOW + 19 * HOUR,
      now: NOW,
      mode: "used",
    });
    expect(young.detailKey).toBe("history.paceResets");
  });

  it("projects the average rate once 15% has elapsed", () => {
    const line = paceLine({ currentUsed: 40, windowStart: start, resetsAt: resets, now: NOW, mode: "used" });
    expect(line.detailKey).toBe("history.paceFor");
    expect(line.detail.percent).toBe(80);
    expect(line.warn).toBe(false);
  });

  it("warns when the projection runs out before the reset", () => {
    const line = paceLine({ currentUsed: 80, windowStart: start, resetsAt: resets, now: NOW, mode: "used" });
    expect(line.detailKey).toBe("history.paceRunOut");
    expect(line.warn).toBe(true);
  });

  it("says the limit is reached at 100%", () => {
    const line = paceLine({ currentUsed: 100, windowStart: start, resetsAt: resets, now: NOW, mode: "used" });
    expect(line.detailKey).toBe("history.paceLimit");
    expect(line.warn).toBe(true);
  });

  it("says there is no usage at 0%", () => {
    const line = paceLine({ currentUsed: 0, windowStart: start, resetsAt: resets, now: NOW, mode: "used" });
    expect(line.detailKey).toBe("history.paceNone");
    expect(line.shown).toBe(0);
  });

  it("rounds the headline to a whole number, keeping under 1%", () => {
    expect(wholePercent(0.4)).toBe("<1");
    expect(wholePercent(26.4)).toBe("26");
    expect(wholePercent(99.6)).toBe(">99");
  });
});
