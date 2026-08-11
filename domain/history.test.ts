import { describe, expect, test } from "vitest";

import type {
  ProviderSnapshot,
  QuotaHistoryObservation,
} from "./model";
import {
  appendQuotaObservation,
  observationFromSnapshot,
  quotaHistorySegments,
} from "./history";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 10, 12);

function snapshot(
  fetchedAt = NOW,
  windows: ProviderSnapshot["windows"] = [
    {
      id: "weekly",
      label: "Weekly usage",
      kind: "rolling",
      usedRatio: 0.42,
      startedAt: NOW - 5 * DAY,
      resetsAt: NOW + 2 * DAY,
      durationMs: 7 * DAY,
      sourceSemantics: "remaining",
    },
  ],
): ProviderSnapshot {
  return {
    providerId: "chatgpt",
    planLabel: "Plus",
    source: "web-session",
    fetchedAt,
    windows,
    credits: [],
  };
}

function observation(
  observedAt: number,
  usedRatio: number,
  resetsAt = NOW + 2 * DAY,
): QuotaHistoryObservation {
  return {
    observedAt,
    windows: [{ windowId: "weekly", usedRatio, resetsAt }],
  };
}

describe("quota history", () => {
  test("converts a snapshot to canonical quota-only history without complementing ratios", () => {
    expect(observationFromSnapshot(snapshot())).toEqual({
      observedAt: NOW,
      windows: [
        {
          windowId: "weekly",
          usedRatio: 0.42,
          startedAt: NOW - 5 * DAY,
          resetsAt: NOW + 2 * DAY,
          durationMs: 7 * DAY,
        },
      ],
    });
  });

  test("preserves an observation that omits a previously reported window", () => {
    expect(
      appendQuotaObservation(
        [observation(NOW - HOUR, 0.4)],
        snapshot(NOW, []),
      ),
    ).toEqual([
      observation(NOW - HOUR, 0.4),
      { observedAt: NOW, windows: [] },
    ]);
  });

  test("sorts observations and keeps the newest supplied value for a duplicate timestamp", () => {
    expect(
      appendQuotaObservation(
        [observation(NOW - HOUR, 0.1), observation(NOW - HOUR, 0.2)],
        snapshot(NOW - 2 * HOUR),
      ),
    ).toEqual([
      observationFromSnapshot(snapshot(NOW - 2 * HOUR)),
      observation(NOW - HOUR, 0.2),
    ]);
  });

  test("breaks segments across omissions, long gaps, and reset changes", () => {
    const first = NOW - 6 * HOUR;
    const afterOmission = NOW - 4 * HOUR;
    const afterGap = NOW - 2 * HOUR;
    const afterReset = NOW - HOUR;
    const firstReset = NOW + DAY;
    const secondReset = NOW + 8 * DAY;
    const history: QuotaHistoryObservation[] = [
      observation(first, 0.4, firstReset),
      { observedAt: first + 30 * 60 * 1_000, windows: [] },
      observation(afterOmission, 0.45, firstReset),
      observation(afterGap, 0.5, firstReset),
      observation(afterReset, 0.03, secondReset),
    ];

    expect(quotaHistorySegments(history, "weekly")).toEqual([
      [{ observedAt: first, usedRatio: 0.4 }],
      [{ observedAt: afterOmission, usedRatio: 0.45 }],
      [{ observedAt: afterGap, usedRatio: 0.5 }],
      [{ observedAt: afterReset, usedRatio: 0.03 }],
    ]);
  });

  test("keeps a segment connected at exactly 90 minutes", () => {
    const first = NOW - 90 * 60 * 1_000;

    expect(
      quotaHistorySegments(
        [observation(first, 0.4), observation(NOW, 0.5)],
        "weekly",
      ),
    ).toEqual([
      [
        { observedAt: first, usedRatio: 0.4 },
        { observedAt: NOW, usedRatio: 0.5 },
      ],
    ]);
    expect(
      quotaHistorySegments(
        [observation(first - 1, 0.4), observation(NOW, 0.5)],
        "weekly",
      ),
    ).toEqual([
      [{ observedAt: first - 1, usedRatio: 0.4 }],
      [{ observedAt: NOW, usedRatio: 0.5 }],
    ]);
  });

  test("keeps every sample from the newest 48 hours", () => {
    const history = Array.from({ length: 5 }, (_, index) =>
      observation(NOW - 47 * HOUR + index * 10 * 60 * 1_000, index / 10),
    );

    expect(appendQuotaObservation(history, snapshot(NOW)).map(({ observedAt }) => observedAt)).toEqual([
      ...history.map(({ observedAt }) => observedAt),
      NOW,
    ]);
  });

  test("compacts older samples to the latest observation in each UTC hour through day 30", () => {
    const sameHourStart = Date.UTC(2026, 7, 7, 9);
    const history = [
      observation(NOW - 31 * DAY, 0.1),
      observation(sameHourStart + 5 * 60 * 1_000, 0.2),
      observation(sameHourStart + 55 * 60 * 1_000, 0.3),
      observation(sameHourStart + HOUR + 10 * 60 * 1_000, 0.4),
    ];

    expect(appendQuotaObservation(history, snapshot(NOW))).toEqual([
      observation(sameHourStart + 55 * 60 * 1_000, 0.3),
      observation(sameHourStart + HOUR + 10 * 60 * 1_000, 0.4),
      observationFromSnapshot(snapshot(NOW)),
    ]);
  });

  test("retains observations exactly at the 48-hour and 30-day cutoffs", () => {
    const fortyEightHourCutoff = NOW - 48 * HOUR;
    const history = [
      observation(NOW - 30 * DAY - 1, 0.1),
      observation(NOW - 30 * DAY, 0.2),
      observation(fortyEightHourCutoff - 10 * 60 * 1_000, 0.3),
      observation(fortyEightHourCutoff, 0.4),
      observation(fortyEightHourCutoff + 10 * 60 * 1_000, 0.5),
    ];

    expect(
      appendQuotaObservation(history, snapshot(NOW)).map(
        ({ observedAt }) => observedAt,
      ),
    ).toEqual([
      NOW - 30 * DAY,
      fortyEightHourCutoff - 10 * 60 * 1_000,
      fortyEightHourCutoff,
      fortyEightHourCutoff + 10 * 60 * 1_000,
      NOW,
    ]);
  });

  test("caps retained history at the newest 1,024 observations", () => {
    const history = Array.from({ length: 1_024 }, (_, index) =>
      observation(NOW - (1_024 - index) * 60_000, index / 1_024),
    );

    const retained = appendQuotaObservation(history, snapshot(NOW));

    expect(retained).toHaveLength(1_024);
    expect(retained[0]?.observedAt).toBe(NOW - 1_023 * 60_000);
    expect(retained.at(-1)).toEqual(observationFromSnapshot(snapshot(NOW)));
  });
});
