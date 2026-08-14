import { describe, expect, test } from "vitest";

import type {
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";
import {
  appendUsageObservation,
  observationFromUsage,
  quotaHistorySegments,
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

  test("segments only quota metric history across a missing metric, a long gap, or a changed cycle", () => {
    const first = NOW - 6 * HOUR;
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
        observedAt: NOW - 4 * HOUR,
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
        observedAt: NOW - 2 * HOUR,
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

    expect(quotaHistorySegments(history, "weekly")).toEqual([
      [{ observedAt: first, usedRatio: 0.4 }],
      [{ observedAt: NOW - 4 * HOUR, usedRatio: 0.45 }],
      [{ observedAt: NOW - 2 * HOUR, usedRatio: 0.5 }],
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

});
