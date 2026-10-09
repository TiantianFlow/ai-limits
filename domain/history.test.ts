import { describe, expect, test } from "vitest";

import type {
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";
import {
  appendUsageObservation,
  cycleBoundaryChanged,
  observationFromUsage,
  quotaHistorySegments,
  quotaHistorySeries,
  retainUsageHistory,
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

  test("keeps a missing sample inside the window and splits when the cycle resets", () => {
    const first = NOW - 8 * HOUR;
    const history = [
      {
        observedAt: first,
        metrics: [
          {
            type: "quota" as const,
            metricId: "weekly",
            usedRatio: 0.4,
            cycle: { cadence: "rolling" as const, durationMs: 7 * DAY, resetsAt: NOW + DAY },
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
            cycle: { cadence: "rolling" as const, durationMs: 7 * DAY, resetsAt: NOW + DAY },
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
            cycle: { cadence: "rolling" as const, durationMs: 7 * DAY, resetsAt: NOW + DAY },
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
            cycle: { cadence: "calendar" as const, durationMs: 7 * DAY, resetsAt: NOW + 8 * DAY },
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
    ["duration", { durationMs: 7 * DAY }, { durationMs: 6 * DAY }],
    ["cadence", { cadence: "rolling" as const }, { cadence: "calendar" as const }],
  ])("breaks typed quota segments when the %s changes and usage drops", (_name, firstCycle, secondCycle) => {
    const first = NOW - HOUR;
    const history = [
      {
        observedAt: first,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.8, cycle: firstCycle }],
      },
      {
        observedAt: NOW,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.1, cycle: secondCycle }],
      },
    ];

    expect(quotaHistorySegments(history, "weekly")).toEqual([
      [{ observedAt: first, usedRatio: 0.8 }],
      [{ observedAt: NOW, usedRatio: 0.1 }],
    ]);
  });

  test("does not break on a startedAt change or a duration change while usage rises", () => {
    const first = NOW - HOUR;
    const continuous = (firstCycle: object, secondCycle: object) => [
      {
        observedAt: first,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.4, cycle: firstCycle }],
      },
      {
        observedAt: NOW,
        metrics: [{ type: "quota" as const, metricId: "weekly", usedRatio: 0.5, cycle: secondCycle }],
      },
    ];

    expect(quotaHistorySegments(continuous(
      { startedAt: NOW - 6 * DAY },
      { startedAt: NOW - 5 * DAY },
    ), "weekly")).toHaveLength(1);
    expect(quotaHistorySegments(continuous(
      { durationMs: 7 * DAY },
      { durationMs: 6 * DAY },
    ), "weekly")).toHaveLength(1);
  });

  test("breaks typed quota segments when only the reset boundary jumps forward", () => {
    const first = NOW - HOUR;
    const history = [
      {
        observedAt: first,
        metrics: [{
          type: "quota" as const,
          metricId: "weekly",
          usedRatio: 0.4,
          cycle: { durationMs: DAY, resetsAt: NOW + DAY },
        }],
      },
      {
        observedAt: NOW,
        metrics: [{
          type: "quota" as const,
          metricId: "weekly",
          usedRatio: 0.5,
          cycle: { durationMs: DAY, resetsAt: NOW + 2 * DAY },
        }],
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

describe("history window identity", () => {
  test("breaks on a reset and a plan-limit change, not on a hole inside the window", () => {
    const points = [
      { observedAt: NOW - 4 * HOUR, usedRatio: 0.2, limit: 80, cycle: { resetsAt: NOW + DAY, durationMs: 7 * DAY } },
      { observedAt: NOW - 2 * HOUR, usedRatio: 0.4, limit: 80, cycle: { resetsAt: NOW + DAY, durationMs: 7 * DAY } },
      { observedAt: NOW - HOUR, usedRatio: 0.1, limit: 100, cycle: { resetsAt: NOW + DAY, durationMs: 7 * DAY } },
      { observedAt: NOW, usedRatio: 0.2, limit: 100, cycle: { resetsAt: NOW + 8 * DAY, durationMs: 7 * DAY } },
    ];

    const series = quotaHistorySeries(points.map((point) => ({
      observedAt: point.observedAt,
      metrics: [{
        type: "quota" as const,
        metricId: "weekly",
        usedRatio: point.usedRatio,
        limit: point.limit,
        cycle: point.cycle,
      }],
    })), "weekly");
    expect(series.segments.map((segment) => segment.breakBefore)).toEqual([
      undefined,
      "limit-change",
      "reset",
    ]);
    expect(series.limitChanges).toEqual([(points[1]!.observedAt + points[2]!.observedAt) / 2]);
    expect(series.resets).toEqual([(points[2]!.observedAt + points[3]!.observedAt) / 2]);
    expect(series.segments[0]?.points).toHaveLength(2);
  });

  test("ignores resetsAt jitter and rolling drift, and still detects a real reset", () => {
    const durationMs = 7 * DAY;
    const baseReset = NOW + durationMs;
    const rising = (step: number, resetsAt: number): UsageHistoryObservation => ({
      observedAt: NOW - 4 * HOUR + step * HOUR,
      metrics: [{
        type: "quota",
        metricId: "weekly",
        usedRatio: 0.2 + step * 0.1,
        cycle: { cadence: "rolling", durationMs, resetsAt },
      }],
    });

    for (const jitter of [
      [0, 40, -25, 80],
      [0, 1_000, 3_000, 2_000],
      [0, 3 * 60 * 1_000, 7 * 60 * 1_000, 12 * 60 * 1_000],
    ]) {
      const series = quotaHistorySeries(
        jitter.map((offset, step) => rising(step, baseReset + offset)),
        "weekly",
        { rangeHours: 48, now: NOW },
      );
      expect(series.resets).toEqual([]);
      expect(series.segments).toHaveLength(1);
    }

    const reset = quotaHistorySeries(
      [
        rising(0, baseReset),
        rising(1, baseReset),
        {
          observedAt: NOW - 2 * HOUR,
          metrics: [{
            type: "quota",
            metricId: "weekly",
            usedRatio: 0.05,
            cycle: { cadence: "rolling", durationMs, resetsAt: baseReset + durationMs },
          }],
        },
        {
          observedAt: NOW - HOUR,
          metrics: [{
            type: "quota",
            metricId: "weekly",
            usedRatio: 0.1,
            cycle: { cadence: "rolling", durationMs, resetsAt: baseReset + durationMs },
          }],
        },
      ],
      "weekly",
      { rangeHours: 48, now: NOW },
    );
    expect(reset.resets).toHaveLength(1);
    expect(reset.segments).toHaveLength(2);
  });

  test("detects a calendar reset that has no durationMs when usage drops", () => {
    const previous = { cadence: "calendar" as const, resetsAt: NOW };
    const next = { cadence: "calendar" as const, resetsAt: NOW + 10 * DAY };
    expect(cycleBoundaryChanged(next, previous, 0.99, 0)).toBe(true);
    expect(cycleBoundaryChanged(next, previous, 0.4, 0.5)).toBe(false);
  });
});
