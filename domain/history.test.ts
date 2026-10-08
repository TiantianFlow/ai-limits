import { describe, expect, test } from "vitest";

import type {
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";
import {
  appendUsageObservation,
  buildTrends,
  detectGaps,
  expectedIntervalMs,
  fitTrend,
  gapThresholdMs,
  minimumGapMs,
  observationFromUsage,
  predictTrend,
  quotaHistorySegments,
  quotaHistorySeries,
  retainUsageHistory,
  splitQuotaSegments,
} from "./history";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 10, 12);

describe("quota history", () => {
  test("records an immutable scalar cycle snapshot", () => {
    const cycle = {
      cadence: "rolling" as const,
      startedAt: NOW - 5 * DAY,
      resetsAt: NOW + 2 * DAY,
      durationMs: 7 * DAY,
    };
    const typedSnapshot: UsageSnapshot = {
      providerKind: "chatgpt",
      source: "fixture",
      fetchedAt: NOW,
      metrics: [
        {
          type: "quota",
          id: "weekly",
          label: "Weekly usage",
          scope: "general",
          usedRatio: 0.42,
          cycle,
        },
        {
          type: "counter",
          id: "spend",
          label: "Spend",
          scope: "product",
          semantic: "spent",
          value: 12.5,
          unit: "USD",
          cycle,
        },
        {
          type: "balance",
          id: "credits",
          label: "Credits",
          scope: "product",
          value: 177.697,
          unit: "credits",
          cycle,
        },
      ],
    };

    const recorded = observationFromUsage(typedSnapshot);
    cycle.resetsAt = NOW + 3 * DAY;

    expect(recorded.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cycle: expect.objectContaining({ resetsAt: NOW + 2 * DAY }),
        }),
        expect.objectContaining({
          cycle: expect.objectContaining({ resetsAt: NOW + 2 * DAY }),
        }),
        expect.objectContaining({
          cycle: expect.objectContaining({ resetsAt: NOW + 2 * DAY }),
        }),
      ]),
    );
  });

  test("does not restamp carried metrics as a new history observation", () => {
    const snapshot: UsageSnapshot = {
      providerKind: "cursor",
      source: "web-session",
      fetchedAt: NOW,
      metrics: [
        {
          type: "quota",
          id: "cursor-models-monthly",
          label: "Cursor models",
          scope: "model",
          usedRatio: 0.17,
        },
        {
          type: "quota",
          id: "grok-bot-weekly",
          label: "Grok Bot",
          scope: "feature",
          usedRatio: 0.92,
          observedAt: NOW - HOUR,
        },
      ],
    };

    expect(observationFromUsage(snapshot)).toEqual({
      observedAt: NOW,
      metrics: [
        {
          metricId: "cursor-models-monthly",
          type: "quota",
          usedRatio: 0.17,
        },
      ],
    });
  });

  test("retains typed metric observations with the established raw, compacted, and capped policy", () => {
    const typedSnapshot: UsageSnapshot = {
      providerKind: "chatgpt",
      source: "fixture",
      fetchedAt: NOW,
      metrics: [
        {
          type: "quota",
          id: "weekly",
          label: "Weekly usage",
          scope: "general",
          usedRatio: 0.42,
          cycle: { resetsAt: NOW + 2 * DAY, durationMs: 7 * DAY },
        },
        {
          type: "counter",
          id: "spend",
          label: "Spend",
          scope: "product",
          semantic: "spent",
          value: 12.5,
          unit: "USD",
        },
      ],
    };
    const sameHourStart = Date.UTC(2026, 7, 7, 9);
    const history = [
      {
        observedAt: NOW - 31 * DAY,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.1 }],
      },
      {
        observedAt: sameHourStart + 5 * 60 * 1_000,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.2 }],
      },
      {
        observedAt: sameHourStart + 55 * 60 * 1_000,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.3 }],
      },
      {
        observedAt: NOW - HOUR,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.4 }],
      },
    ];

    expect(retainUsageHistory(history, NOW)).toEqual([
      history[2],
      history[3],
    ]);
    expect(appendUsageObservation(history, typedSnapshot).at(-1)).toEqual(
      observationFromUsage(typedSnapshot),
    );
  });

  test("bridges a missing sample and a hole at the threshold, and splits on a longer gap or a changed cycle", () => {
    const first = NOW - 8 * HOUR;
    const history = [
      {
        observedAt: first,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.4,
            cycle: { cadence: "rolling" as const, resetsAt: NOW + DAY },
          },
        ],
      },
      {
        observedAt: first + 30 * 60 * 1_000,
        metrics: [{ type: "counter" as const, metricId: "spend", semantic: "spent" as const, value: 12.5, unit: "USD" }],
      },
      {
        observedAt: first + 2 * HOUR,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.45,
            cycle: { cadence: "rolling" as const, resetsAt: NOW + DAY },
          },
        ],
      },
      {
        observedAt: first + 2 * HOUR + 1,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.5,
            cycle: { cadence: "rolling" as const, resetsAt: NOW + DAY },
          },
        ],
      },
      {
        observedAt: NOW - HOUR,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.03,
            cycle: { cadence: "calendar" as const, resetsAt: NOW + 8 * DAY },
          },
        ],
      },
    ];

    expect(quotaHistorySegments(history, "weekly", { rangeHours: 48, now: NOW })).toEqual([
      [
        { observedAt: first, usedRatio: 0.4 },
        { observedAt: first + 2 * HOUR, usedRatio: 0.45 },
        { observedAt: first + 2 * HOUR + 1, usedRatio: 0.5 },
      ],
      [{ observedAt: NOW - HOUR, usedRatio: 0.03 }],
    ]);
  });

  test.each([
    ["start", { startedAt: NOW - 6 * DAY }, { startedAt: NOW - 5 * DAY }],
    ["duration", { durationMs: 7 * DAY }, { durationMs: 6 * DAY }],
    ["cadence", { cadence: "rolling" as const }, { cadence: "calendar" as const }],
    ["reset", { resetsAt: NOW + DAY }, { resetsAt: NOW + 2 * DAY }],
  ])("breaks typed quota segments when only the %s boundary changes", (_name, firstCycle, secondCycle) => {
    const first = NOW - HOUR;
    const history = [
      {
        observedAt: first,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.4,
            cycle: firstCycle,
          },
        ],
      },
      {
        observedAt: NOW,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.5,
            cycle: secondCycle,
          },
        ],
      },
    ];

    expect(quotaHistorySegments(history, "weekly")).toEqual([
      [{ observedAt: first, usedRatio: 0.4 }],
      [{ observedAt: NOW, usedRatio: 0.5 }],
    ]);
  });

  test("ignores same-ID counter and balance samples in typed quota segments", () => {
    const first = NOW - HOUR;
    const history = [
      {
        observedAt: first,
        metrics: [
          { type: "quota" as const, metricId: "weekly", usedRatio: 0.4 },
        ],
      },
      {
        observedAt: NOW,
        metrics: [
          { type: "counter" as const, metricId: "weekly", semantic: "spent" as const, value: 12.5, unit: "USD" },
          { type: "balance" as const, metricId: "weekly", value: 177.697, unit: "credits" },
          { type: "quota" as const, metricId: "weekly", usedRatio: 0.5 },
        ],
      },
    ];

    expect(quotaHistorySegments(history, "weekly")).toEqual([
      [
        { observedAt: first, usedRatio: 0.4 },
        { observedAt: NOW, usedRatio: 0.5 },
      ],
    ]);
  });

  test("retains typed raw boundaries, newest duplicate timestamps, and the 1,024-observation cap", () => {
    const rawCutoff = NOW - 48 * HOUR;
    const typedObservation = (observedAt: number, usedRatio: number) => ({
      observedAt,
      metrics: [
        { type: "quota" as const, metricId: "weekly", usedRatio },
        {
          type: "counter" as const,
          metricId: "spend",
          semantic: "spent" as const,
          value: usedRatio * 100,
          unit: "USD",
        },
        {
          type: "balance" as const,
          metricId: "credits",
          value: 100 - usedRatio * 100,
          unit: "credits",
        },
      ],
    });
    const duplicates = [
      typedObservation(NOW - 30 * DAY - 1, 0.1),
      typedObservation(rawCutoff, 0.2),
      typedObservation(rawCutoff, 0.3),
      typedObservation(rawCutoff + 1, 0.4),
    ];

    expect(retainUsageHistory(duplicates, NOW)).toEqual([
      duplicates[2],
      duplicates[3],
    ]);

    const capped = Array.from({ length: 1_025 }, (_, index) =>
      typedObservation(NOW - (1_025 - index) * 60_000, index / 1_025),
    );
    const retained = retainUsageHistory(capped, NOW);

    expect(retained).toHaveLength(1_024);
    expect(retained[0]?.observedAt).toBe(NOW - 1_024 * 60_000);
    expect(retained.at(-1)).toEqual(capped.at(-1));
    expect(retained.every(({ metrics }) => metrics.length === 3)).toBe(true);
  });

  test("stores a quota plan limit so later limit changes can break the series", () => {
    const snapshot: UsageSnapshot = {
      providerKind: "chatgpt",
      source: "fixture",
      fetchedAt: NOW,
      metrics: [
        {
          type: "quota",
          id: "weekly",
          label: "Weekly usage",
          scope: "general",
          usedRatio: 0.42,
          limit: 100,
        },
      ],
    };

    expect(observationFromUsage(snapshot).metrics).toEqual([
      { type: "quota", metricId: "weekly", usedRatio: 0.42, limit: 100 },
    ]);
  });
});

const INTERVAL_15 = 15 * 60 * 1_000;

describe("history gap tolerance", () => {
  test("derives the expected interval from collection cadence and stored resolution", () => {
    expect(expectedIntervalMs(48)).toBe(INTERVAL_15);
    expect(expectedIntervalMs(undefined)).toBe(INTERVAL_15);
    expect(expectedIntervalMs(7 * 24)).toBe(HOUR);
    expect(expectedIntervalMs(30 * 24)).toBe(HOUR);
    expect(expectedIntervalMs(48, NOW, NOW - 49 * HOUR)).toBe(HOUR);
    expect(expectedIntervalMs(48, NOW, NOW - HOUR)).toBe(INTERVAL_15);
  });

  test("floors the gap threshold at 2 h, 6 h, and 12 h", () => {
    expect(minimumGapMs(48)).toBe(2 * HOUR);
    expect(minimumGapMs(undefined)).toBe(2 * HOUR);
    expect(minimumGapMs(7 * 24)).toBe(6 * HOUR);
    expect(minimumGapMs(30 * 24)).toBe(12 * HOUR);
    expect(gapThresholdMs(48)).toBe(2 * HOUR);
    expect(gapThresholdMs(7 * 24)).toBe(6 * HOUR);
    expect(gapThresholdMs(30 * 24)).toBe(12 * HOUR);
  });

  test("bridges a single missed sample and a one-to-two interval hole", () => {
    const start = NOW - 2 * HOUR;
    const points = [0, 1, 3, 6].map((step) => ({
      observedAt: start + step * INTERVAL_15,
    }));

    expect(detectGaps(points, 2 * HOUR, INTERVAL_15)).toEqual({
      gaps: [],
      bridgedSamples: 1 + 2,
      thresholdMs: 2 * HOUR,
    });
  });

  test("bridges a hole equal to the threshold and shades one just past it", () => {
    const atThreshold = [
      { observedAt: NOW - 4 * HOUR },
      { observedAt: NOW - 2 * HOUR },
    ];
    const pastThreshold = [
      { observedAt: NOW - 4 * HOUR },
      { observedAt: NOW - 2 * HOUR + 60 * 1_000 },
    ];

    expect(detectGaps(atThreshold, 2 * HOUR, INTERVAL_15).gaps).toEqual([]);
    expect(detectGaps(atThreshold, 2 * HOUR, INTERVAL_15).bridgedSamples).toBe(7);

    const shaded = detectGaps(pastThreshold, 2 * HOUR, INTERVAL_15);
    expect(shaded.bridgedSamples).toBe(0);
    expect(shaded.gaps).toEqual([
      {
        from: NOW - 4 * HOUR,
        to: NOW - 2 * HOUR + 60 * 1_000,
        labelHours: (2 * HOUR + 60 * 1_000) / HOUR,
      },
    ]);
  });

  test("labels a long gap with its span in hours", () => {
    const points = [
      { observedAt: NOW - 3 * DAY },
      { observedAt: NOW },
    ];

    expect(detectGaps(points, 12 * HOUR, HOUR).gaps).toEqual([
      { from: NOW - 3 * DAY, to: NOW, labelHours: 72 },
    ]);
  });

  test("breaks on a reset and a plan-limit change, not on a bridged hole", () => {
    const points = [
      { observedAt: NOW - 4 * HOUR, usedRatio: 0.2, limit: 80, cycle: { resetsAt: NOW + DAY } },
      { observedAt: NOW - 2 * HOUR, usedRatio: 0.4, limit: 80, cycle: { resetsAt: NOW + DAY } },
      { observedAt: NOW - HOUR, usedRatio: 0.1, limit: 100, cycle: { resetsAt: NOW + DAY } },
      { observedAt: NOW, usedRatio: 0.2, limit: 100, cycle: { resetsAt: NOW + 8 * DAY } },
    ];

    const split = splitQuotaSegments(points, 2 * HOUR);
    expect(split.segments.map((segment) => segment.breakBefore)).toEqual([
      undefined,
      "limit-change",
      "reset",
    ]);
    expect(split.limitChanges).toEqual([(points[1]!.observedAt + points[2]!.observedAt) / 2]);
    expect(split.resets).toEqual([(points[2]!.observedAt + points[3]!.observedAt) / 2]);
    expect(split.segments[0]?.points).toHaveLength(2);
  });

  test("counts only bridged misses, not the long gap", () => {
    const series = quotaHistorySeries(
      [
        { observedAt: NOW - 10 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.1 }] },
        { observedAt: NOW - 10 * HOUR + 2 * INTERVAL_15, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.2 }] },
        { observedAt: NOW, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.3 }] },
      ],
      "weekly",
      { rangeHours: 48, now: NOW },
    );

    expect(series.bridgedSamples).toBe(1);
    expect(series.gaps).toHaveLength(1);
    expect(series.segments).toHaveLength(2);
    expect(series.gapThresholdMs).toBe(2 * HOUR);
  });

  test("shades a hole that contains a reset, and still breaks the line there", () => {
    const series = quotaHistorySeries(
      [
        { observedAt: NOW - 40 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.8, cycle: { resetsAt: NOW } }] },
        { observedAt: NOW - 39 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.9, cycle: { resetsAt: NOW } }] },
        { observedAt: NOW - 15 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.1, cycle: { resetsAt: NOW + 7 * DAY } }] },
        { observedAt: NOW - 14 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.15, cycle: { resetsAt: NOW + 7 * DAY } }] },
        { observedAt: NOW - 13 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.2, cycle: { resetsAt: NOW + 7 * DAY } }] },
      ],
      "weekly",
      { rangeHours: 48, now: NOW },
    );

    expect(series.gaps).toContainEqual({
      from: NOW - 39 * HOUR, to: NOW - 15 * HOUR, labelHours: 24,
    });
    expect(series.resets).toHaveLength(1);
    expect(series.segments.map((segment) => segment.points.length)).toEqual([2, 3]);
    const shadedReads = series.gaps.reduce(
      (total, gap) => total + Math.round(gap.labelHours * HOUR / INTERVAL_15) - 1,
      0,
    );
    expect(series.bridgedSamples).toBeLessThan(shadedReads);
  });

  test("shades a hole that contains a plan-limit change", () => {
    const series = quotaHistorySeries(
      [
        { observedAt: NOW - 40 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.4, limit: 100 }] },
        { observedAt: NOW - 20 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.2, limit: 200 }] },
        { observedAt: NOW - 19 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.25, limit: 200 }] },
        { observedAt: NOW - 18 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.3, limit: 200 }] },
        { observedAt: NOW, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.35, limit: 200 }] },
      ],
      "weekly",
      { rangeHours: 48, now: NOW },
    );

    expect(series.gaps).toContainEqual({
      from: NOW - 40 * HOUR, to: NOW - 20 * HOUR, labelHours: 20,
    });
    expect(series.limitChanges).toHaveLength(1);
    expect(series.gaps.filter((gap) => gap.labelHours === 20)).toHaveLength(1);
  });

  test("does not count a bridged read twice when the series is split", () => {
    const series = quotaHistorySeries(
      [
        { observedAt: NOW - 5 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.2, cycle: { resetsAt: NOW } }] },
        { observedAt: NOW - 5 * HOUR + 2 * INTERVAL_15, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.3, cycle: { resetsAt: NOW } }] },
        { observedAt: NOW - 4 * HOUR, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.1, cycle: { resetsAt: NOW + DAY } }] },
        { observedAt: NOW - 4 * HOUR + INTERVAL_15, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.15, cycle: { resetsAt: NOW + DAY } }] },
        { observedAt: NOW - 4 * HOUR + 2 * INTERVAL_15, metrics: [{ type: "quota", metricId: "weekly", usedRatio: 0.2, cycle: { resetsAt: NOW + DAY } }] },
      ],
      "weekly",
      { rangeHours: 48, now: NOW },
    );

    expect(series.segments).toHaveLength(2);
    expect(series.bridgedSamples).toBe(1);
    expect(series.gaps).toHaveLength(0);
  });
});

describe("history trend fit", () => {
  test("recovers slope and intercept on a known line", () => {
    const points = [0, 1, 2, 3].map((hour) => ({
      observedAt: NOW + hour * HOUR,
      usedRatio: 0.2 + hour * 0.1,
    }));

    const fit = fitTrend(points);
    expect(fit?.originMs).toBe(NOW);
    expect(fit?.intercept).toBeCloseTo(0.2);
    expect(fit?.slope).toBeCloseTo(0.1 / HOUR);
    expect(predictTrend(fit!, NOW + 2 * HOUR)).toBeCloseTo(0.4);
  });

  test("returns null for fewer than two points and for a single timestamp", () => {
    expect(fitTrend([])).toBeNull();
    expect(fitTrend([{ observedAt: NOW, usedRatio: 0.4 }])).toBeNull();
    expect(
      fitTrend([
        { observedAt: NOW, usedRatio: 0.2 },
        { observedAt: NOW, usedRatio: 0.8 },
      ]),
    ).toBeNull();
  });

  test("fits two points but withholds a trend until a segment has three", () => {
    const two = [
      { observedAt: NOW - HOUR, usedRatio: 0.2 },
      { observedAt: NOW, usedRatio: 0.4 },
    ];
    expect(fitTrend(two)?.slope).toBeCloseTo(0.2 / HOUR);
    expect(buildTrends([{ points: two }])).toEqual([]);
    expect(
      buildTrends([
        {
          points: [
            ...two,
            { observedAt: NOW + HOUR, usedRatio: 0.6 },
          ],
        },
      ]),
    ).toHaveLength(1);
  });

  test("clamps the prediction to 0–100%", () => {
    const fit = fitTrend([
      { observedAt: NOW, usedRatio: 0.9 },
      { observedAt: NOW + HOUR, usedRatio: 1 },
    ])!;

    expect(predictTrend(fit, NOW + 5 * HOUR)).toBe(1);
    expect(predictTrend({ ...fit, slope: -fit.slope, intercept: 0.1 }, NOW + 5 * HOUR)).toBe(0);
  });

  test("keeps only the newest trend when there are many short cycles", () => {
    const segments = Array.from({ length: 9 }, (_, index) => ({
      points: [0, 1, 2].map((step) => ({
        observedAt: NOW + (index * 3 + step) * HOUR,
        usedRatio: 0.1 * (step + 1),
      })),
    }));

    const trends = buildTrends(segments);
    expect(trends).toHaveLength(1);
    expect(trends[0]?.from).toBe(segments[8]!.points[0]!.observedAt);
    expect(trends[0]?.to).toBe(segments[8]!.points[2]!.observedAt);
  });

  test("reports used ratios so Left mode can complement them", () => {
    const series = quotaHistorySeries(
      [0, 1, 2].map((hour) => ({
        observedAt: NOW + hour * HOUR,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.25 + hour * 0.25 }],
      })),
      "weekly",
      { rangeHours: 48, now: NOW + 2 * HOUR },
    );

    expect(series.trends).toEqual([
      {
        from: NOW,
        to: NOW + 2 * HOUR,
        fromRatio: expect.closeTo(0.25),
        toRatio: expect.closeTo(0.75),
      },
    ]);
    expect(1 - series.trends[0]!.fromRatio).toBeCloseTo(0.75);
    expect(1 - series.trends[0]!.toRatio).toBeCloseTo(0.25);
  });
});
