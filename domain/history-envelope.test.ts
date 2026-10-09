import { describe, expect, test } from "vitest";

import type { UsageHistoryObservation } from "./model";
import {
  BAR_MIN_WINDOW_PX,
  CALENDAR_NOMINAL_MS,
  ENVELOPE_MIN_WINDOW_PX,
  buildEnvelopeSeries,
  buildWindowEnvelope,
  capRebaseMarkers,
  coverageSpans,
  dailyBuckets,
  detailLevel,
  expectedIntervalMs,
  fallbackPolicy,
  fixedGridFrames,
  idleSpansBetween,
  isIdleProofReading,
  meterPolicy,
  predictUsed,
  sameResetKey,
  tailToleranceMs,
  uncoveredGaps,
  windowBar,
  windowTrend,
  type EnvelopeReading,
  type WindowSpan,
} from "./history-envelope";
import { retainUsageHistory } from "./history";
import { FIXTURE_NOW, REALISTIC_METERS, idleGrid } from "./history-realistic";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 10, 16);

function reading(
  observedAt: number,
  usedRatio: number,
  extra: Partial<EnvelopeReading> = {},
): EnvelopeReading {
  return {
    observedAt,
    usedRatio,
    left: (1 - usedRatio) * 100,
    ...extra,
  };
}

function observation(
  observedAt: number,
  metricId: string,
  usedRatio: number,
  cycle?: object,
  limit?: number,
): UsageHistoryObservation {
  return {
    observedAt,
    metrics: [{
      type: "quota",
      metricId,
      usedRatio,
      ...(limit === undefined ? {} : { limit }),
      ...(cycle ? { cycle } : {}),
    }],
  };
}

describe("envelope bands", () => {
  test("clamps a rise within 1 point and restarts on a larger rise or a limit change", () => {
    const frame = { start: NOW - 5 * HOUR, end: NOW, windowMs: 5 * HOUR };
    const events: { at: number; kind: "limit-change" | "rebase" }[] = [];
    const window = buildWindowEnvelope(frame, [
      reading(NOW - 4 * HOUR, 0.2),
      reading(NOW - 3 * HOUR, 0.19),
      reading(NOW - 2 * HOUR, 0.1, { limit: 100 }),
      reading(NOW - HOUR, 0.05, { limit: 200 }),
    ], NOW + HOUR, events);

    expect(window.values[1]).toBeCloseTo(80);
    expect(events.map((event) => event.kind)).toEqual(["rebase", "limit-change"]);
    expect(window.bands.some((band) => band.event)).toBe(true);
    expect(window.bands[0]).toMatchObject({ upper: 100, lower: 80 });
  });

  test("trusts a tail inside the compacted-age tolerance and leaves an older one open", () => {
    const frame = { start: NOW - 7 * DAY, end: NOW, windowMs: 7 * DAY };
    const fresh = buildWindowEnvelope(frame, [reading(NOW - 20 * 60 * 1_000, 0.4)], NOW + DAY, []);
    expect(fresh.tailTrusted).toBe(true);
    expect(fresh.endLower).toBeCloseTo(60);

    const stale = buildWindowEnvelope(frame, [reading(NOW - 3 * HOUR, 0.4)], NOW + DAY, []);
    expect(stale.tailTrusted).toBe(false);
    expect(stale.bands.at(-1)?.open).toBe(true);

    const compacted = tailToleranceMs(7 * DAY, NOW, NOW - 49 * HOUR);
    expect(expectedIntervalMs(NOW, NOW - 49 * HOUR)).toBe(HOUR);
    expect(compacted).toBe(2 * HOUR);
    expect(tailToleranceMs(5 * HOUR, NOW, NOW)).toBe(30 * 60 * 1_000);
  });

  test("cuts the current window at now", () => {
    const frame = { start: NOW - HOUR, end: NOW + 4 * HOUR, windowMs: 5 * HOUR };
    const window = buildWindowEnvelope(frame, [reading(NOW - 30 * 60 * 1_000, 0.2)], NOW, []);
    expect(window.current).toBe(true);
    expect(window.bands.at(-1)?.to).toBe(NOW);
  });

  test("caps rebase markers and clamps the extra rises", () => {
    const frame = { start: NOW - 10 * HOUR, end: NOW, windowMs: 10 * HOUR };
    const readings = [0.5, 0.1, 0.5, 0.1, 0.5, 0.1, 0.5, 0.1].map((used, index) =>
      reading(frame.start + (index + 1) * HOUR, used),
    );
    const events: { at: number; kind: "limit-change" | "rebase" }[] = [];
    const built = buildWindowEnvelope(frame, readings, NOW + HOUR, events);
    expect(events.filter((event) => event.kind === "rebase").length).toBeGreaterThan(3);
    const capped = capRebaseMarkers(built, events);
    expect(capped.capped).toBe(true);
    expect(capped.events.filter((event) => event.kind === "rebase")).toHaveLength(0);
    expect(capped.window.values.every((value, index) => index === 0 || value <= capped.window.values[index - 1]!)).toBe(true);
  });
});

describe("frames", () => {
  test("draws every fixed-grid window and merges the empty ones", () => {
    const anchor = NOW;
    const frames = fixedGridFrames(anchor, 7 * DAY, NOW - 28 * DAY, NOW);
    expect(frames).toHaveLength(4);
    expect(frames[0]?.end).toBe(NOW - 21 * DAY);
    const series = buildEnvelopeSeries([
      observation(NOW - 20 * DAY, "weekly", 0.3, { cadence: "calendar", durationMs: 7 * DAY, resetsAt: NOW - 14 * DAY }),
      observation(NOW - DAY, "weekly", 0.5, { cadence: "calendar", durationMs: 7 * DAY, resetsAt: NOW }),
    ], {
      providerKind: "claude",
      metricId: "weekly",
      now: NOW,
      rangeStart: NOW - 28 * DAY,
      rangeEnd: NOW,
    });
    expect(series.policy).toBe("fixed");
    expect(series.spans.length).toBeGreaterThanOrEqual(4);
    expect(series.unknownRuns.length).toBeGreaterThan(0);
    expect(series.unknownRuns.reduce((total, run) => total + (run.end - run.start), 0)).toBeGreaterThan(7 * DAY);
  });

  test("keeps first-use windows only where readings exist", () => {
    const short = idleSpansBetween(
      [{ start: NOW - 10 * HOUR, end: NOW - 5 * HOUR, windowMs: 5 * HOUR }],
      [],
      5 * HOUR,
      NOW - 12 * HOUR,
      NOW,
    );
    expect(short.some((span) => span.kind === "idle")).toBe(true);

    const proven = idleSpansBetween(
      [{ start: NOW - 20 * HOUR, end: NOW - 15 * HOUR, windowMs: 5 * HOUR }],
      [reading(NOW - 8 * HOUR, 0, { omitted: true })],
      5 * HOUR,
      NOW - 20 * HOUR,
      NOW,
    );
    expect(proven.some((span) => span.proofReadings > 0 && span.kind === "idle")).toBe(true);

    const unknown = idleSpansBetween(
      [{ start: NOW - 30 * HOUR, end: NOW - 25 * HOUR, windowMs: 5 * HOUR }],
      [],
      5 * HOUR,
      NOW - 30 * HOUR,
      NOW,
    );
    expect(unknown.some((span) => span.kind === "unknown")).toBe(true);
  });

  test("treats a ChatGPT zero reading whose reset is one window ahead as idle", () => {
    const idle = reading(NOW - 2 * DAY, 0, { resetsAt: NOW - 2 * DAY + 30 * DAY, durationMs: 30 * DAY });
    expect(isIdleProofReading(idle, 30 * DAY, NOW)).toBe(true);
    const active = reading(NOW - 2 * DAY, 0.1, { resetsAt: NOW - 2 * DAY + 30 * DAY, durationMs: 30 * DAY });
    expect(isIdleProofReading(active, 30 * DAY, NOW)).toBe(false);
    const kimi = reading(NOW - HOUR, 0, { resetsAt: NOW + 2 * HOUR, durationMs: 5 * HOUR });
    expect(isIdleProofReading(kimi, 5 * HOUR, NOW)).toBe(false);
  });

  test("treats an omitted first-use metric as an idle proof", () => {
    const series = buildEnvelopeSeries([
      observation(NOW - 30 * HOUR, "weekly", 0.4, { cadence: "calendar", durationMs: 7 * DAY, resetsAt: NOW }),
      observation(NOW - 10 * HOUR, "five-hour", 0.3, { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: NOW - 5 * HOUR }),
    ], {
      providerKind: "claude",
      metricId: "five-hour",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
      omittedObservations: [{ observedAt: NOW - 30 * HOUR }],
    });
    expect(series.policy).toBe("first-use");
    expect(series.idleSpans.some((span) => span.proofReadings > 0)).toBe(true);
  });
});

describe("detail, bars, and days", () => {
  test("picks the tier from pixels per window", () => {
    const range = 7 * DAY;
    const width = 280;
    const px = (windowMs: number) => (windowMs / range) * width;
    expect(px(7 * DAY)).toBeGreaterThanOrEqual(ENVELOPE_MIN_WINDOW_PX);
    expect(detailLevel(7 * DAY, range, width)).toBe("envelope");
    expect(detailLevel(7 * DAY, 30 * DAY, 340)).toBe("envelope");
    expect(detailLevel(30 * DAY, 30 * DAY, 340)).toBe("envelope");
    expect(detailLevel(DAY, 30 * DAY, 340)).toBe("bars");
    expect(detailLevel(5 * HOUR, 2 * DAY, width)).toBe("envelope");
    const barWindow = (range * 23.9) / width;
    expect(detailLevel(barWindow, range, width)).toBe("bars");
    expect(detailLevel((range * 24) / width, range, width)).toBe("envelope");
    expect(detailLevel((range * 4) / width, range, width)).toBe("bars");
    expect(detailLevel((range * 3.9) / width, range, width)).toBe("daily");
    expect(detailLevel(DAY, 90 * DAY, width)).toBe("bars");
    expect(BAR_MIN_WINDOW_PX).toBe(4);
  });

  test("reports certain usage and an open end", () => {
    const open: WindowSpan = {
      id: "open",
      start: NOW - 5 * HOUR,
      end: NOW,
      current: false,
      kind: "observed",
      readings: [],
      bands: [],
      values: [80],
      observedFirst: 80,
      observedMin: 70,
      endLower: 0,
      tailTrusted: false,
      hasEvent: false,
      windowMs: 5 * HOUR,
    };
    expect(windowBar(open)).toEqual({ certainUsed: 30, open: true });
    expect(windowBar({ ...open, kind: "unknown", observedMin: null })).toBeNull();
  });

  test("buckets by local midnight and lets a trusted end win a tie", () => {
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime() - DAY;
    const busy = (id: string, trusted: boolean, used: number): WindowSpan => ({
      id,
      start: start + HOUR,
      end: start + 6 * HOUR,
      current: false,
      kind: "observed",
      readings: [],
      bands: [],
      values: [],
      observedFirst: 100 - used,
      observedMin: 100 - used,
      endLower: trusted ? 100 - used : 0,
      tailTrusted: trusted,
      hasEvent: false,
      windowMs: 5 * HOUR,
    });
    const buckets = dailyBuckets(
      [busy("open", false, 40), busy("trusted", true, 40)],
      start,
      start + DAY,
      NOW,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.window?.id).toBe("trusted");
    expect(buckets[0]?.start).toBe(start);
  });
});

describe("trend gating", () => {
  function complete(index: number, span: number): WindowSpan {
    return {
      id: `w-${index}`,
      start: NOW - span + index * (span / 6) - DAY,
      end: NOW - span + index * (span / 6),
      current: false,
      kind: "observed",
      readings: [],
      bands: [],
      values: [80 - index],
      observedFirst: 80,
      observedMin: 70 - index,
      endLower: 70 - index,
      tailTrusted: true,
      hasEvent: false,
      windowMs: DAY,
    };
  }

  test("withholds a trend at five windows and fits six that cover the range", () => {
    const five = windowTrend(Array.from({ length: 5 }, (_, index) => complete(index, 10 * DAY)), 30 * DAY);
    expect(five.reason).toBe("count");
    expect(five.fit).toBeNull();
    const six = windowTrend(Array.from({ length: 6 }, (_, index) => complete(index, 10 * DAY)), 30 * DAY);
    expect(six.reason).toBeNull();
    expect(six.fit?.slope).toBeGreaterThan(0);
    expect(predictUsed(six.fit!, six.points[0]!.at)).toBeGreaterThanOrEqual(0);
    expect(predictUsed(six.fit!, six.points[0]!.at)).toBeLessThanOrEqual(100);
  });

  test("withholds a trend whose windows cover too little of the range", () => {
    const clustered = windowTrend(
      Array.from({ length: 6 }, (_, index) => complete(index, DAY)),
      30 * DAY,
    );
    expect(clustered.reason).toBe("span");
  });
});

describe("migration, policy, and compaction", () => {
  test("assigns an unanchored fixed reading to its grid window and does not invent a reset", () => {
    const series = buildEnvelopeSeries([
      observation(NOW - 3 * DAY, "weekly", 0.4, { cadence: "calendar", durationMs: 7 * DAY, resetsAt: NOW }),
      observation(NOW - 2 * DAY, "weekly", 0.5),
    ], {
      providerKind: "claude",
      metricId: "weekly",
      now: NOW,
      rangeStart: NOW - 14 * DAY,
      rangeEnd: NOW,
    });
    const window = series.spans.find((item) => item.kind === "observed" && item.readings.length === 2);
    expect(window).toBeDefined();
    expect(window?.readings.every((item) => item.observedAt <= NOW)).toBe(true);
  });

  test("turns an unanchored first-use zero into an idle proof and a nonzero into an open window", () => {
    const series = buildEnvelopeSeries([
      observation(NOW - 8 * HOUR, "five-hour", 0),
      observation(NOW - 3 * HOUR, "five-hour", 0.25),
    ], {
      providerKind: "claude",
      metricId: "five-hour",
      now: NOW,
      rangeStart: NOW - 24 * HOUR,
      rangeEnd: NOW,
    });
    expect(series.spans.some((window) => window.kind === "observed" && !window.tailTrusted)).toBe(true);
    expect(series.idleSpans.some((span) => span.proofReadings > 0)).toBe(true);
  });

  test("uses the per-meter table and the generic fallback", () => {
    expect(meterPolicy("kimi", "monthly-total")?.policy).toBe("fixed");
    expect(meterPolicy("kimi", "five-hour-coding")?.policy).toBe("first-use");
    expect(meterPolicy("claude", "five-hour")?.policy).toBe("first-use");
    expect(fallbackPolicy("calendar", undefined)).toBe("fixed");
    expect(fallbackPolicy("rolling", 30 * DAY)).toBe("fixed");
    expect(fallbackPolicy("rolling", 5 * HOUR)).toBe("first-use");
    expect(CALENDAR_NOMINAL_MS).toBe(28 * DAY);
  });

  test("draws a calendar month that stores startedAt and resetsAt but no durationMs", () => {
    // Shape of a monthly total: one cycle of sparse readings climbing toward
    // the cap, then a reset and two readings. Values are synthetic.
    const cycleStart = NOW - 26 * DAY;
    const cycleEnd = cycleStart + 30 * DAY;
    const nextEnd = cycleEnd + 31 * DAY;
    const history: UsageHistoryObservation[] = [];
    for (let index = 0; index < 44; index += 1) {
      const at = cycleStart + ((index + 0.5) / 44) * (cycleEnd - cycleStart);
      history.push(observation(at, "monthly-total", 0.02 + (index / 43) * 0.97, {
        cadence: "calendar",
        startedAt: cycleStart,
        resetsAt: cycleEnd,
      }));
    }
    history.push(
      observation(cycleEnd + 6 * HOUR, "monthly-total", 0.01, {
        cadence: "calendar",
        startedAt: cycleEnd,
        resetsAt: nextEnd,
      }),
      observation(cycleEnd + 20 * HOUR, "monthly-total", 0.04, {
        cadence: "calendar",
        startedAt: cycleEnd,
        resetsAt: nextEnd,
      }),
    );
    const series = buildEnvelopeSeries(history, {
      providerKind: "kimi",
      metricId: "monthly-total",
      now: cycleEnd + 2 * DAY,
      rangeStart: cycleEnd + 2 * DAY - 30 * DAY,
      rangeEnd: cycleEnd + 2 * DAY,
    });
    const observed = series.spans.filter((window) => window.kind === "observed");
    expect(observed.length).toBeGreaterThanOrEqual(2);
    const first = observed[0]!;
    const span = first.end - first.start;
    expect(span).toBeGreaterThan(20 * DAY);
    expect(span).toBeLessThan(40 * DAY);
    expect(first.readings.length).toBeGreaterThan(20);
    const unknownOverReadings = series.spans.filter((window) =>
      window.kind === "unknown" &&
      history.some((item) => item.observedAt >= window.start && item.observedAt < window.end),
    );
    expect(unknownOverReadings).toEqual([]);
  });

  test("keeps the last reading before a window boundary while compacting the hour", () => {
    const hourStart = NOW - 10 * DAY;
    const before = hourStart + 20 * 60 * 1_000;
    const after = hourStart + 40 * 60 * 1_000;
    const history = [
      observation(before, "monthly-total", 0.99, { cadence: "calendar", resetsAt: hourStart }),
      observation(after, "monthly-total", 0, { cadence: "calendar", resetsAt: hourStart + 30 * DAY }),
      observation(NOW - HOUR, "monthly-total", 0.1, { cadence: "calendar", resetsAt: hourStart + 30 * DAY }),
    ];
    const retained = retainUsageHistory(history, NOW);
    expect(retained.map((item) => item.observedAt)).toEqual(expect.arrayContaining([before, after]));
  });
});

describe("synthetic shapes", () => {
  test("builds a dense fixed weekly series", () => {
    const history: UsageHistoryObservation[] = [];
    for (let day = 21; day >= 0; day -= 1) {
      const end = NOW - (day % 7) * DAY;
      history.push(observation(NOW - day * DAY, "weekly", Math.min(0.9, (7 - (day % 7)) / 10), {
        cadence: "calendar",
        durationMs: 7 * DAY,
        resetsAt: NOW - Math.floor(day / 7) * 7 * DAY,
      }));
    }
    const series = buildEnvelopeSeries(history, {
      providerKind: "claude",
      metricId: "weekly",
      now: NOW,
      rangeStart: NOW - 21 * DAY,
      rangeEnd: NOW,
    });
    expect(series.spans.filter((window) => window.kind === "observed").length).toBeGreaterThanOrEqual(3);
  });

  test("treats a fixed 5-hour grid that reports 0% as idle between windows", () => {
    const anchor = NOW - 46 * HOUR;
    const history = idleGrid({
      metricId: "five-hour-coding",
      windowMs: 5 * HOUR,
      now: NOW,
      anchor,
    });
    const series = buildEnvelopeSeries(history, {
      providerKind: "kimi",
      metricId: "five-hour-coding",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
    });
    const idle = series.idleSpans.filter((span) => span.kind === "idle");
    expect(idle.length).toBeGreaterThan(0);
    const idleMs = idle.reduce((sum, span) => sum + (span.end - span.start), 0);
    expect(idleMs).toBeGreaterThan(20 * HOUR);
    // The hole before the first non-zero reading stays "No readings".
    // Everything after the zeros is idle, with no blank strip.
    const unknown = series.idleSpans.filter((span) => span.kind === "unknown");
    expect(unknown.every((span) => span.end <= history[0]!.observedAt + 5 * HOUR)).toBe(true);
    const covered = uncoveredGaps(
      [
        ...series.spans.map((window) => ({ from: window.start, to: window.end })),
        ...series.idleSpans.map((span) => ({ from: span.start, to: span.end })),
      ],
      NOW - 48 * HOUR,
      NOW,
      60_000,
    );
    expect(covered).toEqual([]);
  });

  test("builds a sparse first-use 5-hour series with multi-hour holes", () => {
    const history = [0, 6, 20, 40].map((hours, index) =>
      observation(NOW - (48 - hours) * HOUR, "five-hour-coding", 0.1 * (index + 1), {
        cadence: "rolling",
        durationMs: 5 * HOUR,
        resetsAt: NOW - (48 - hours) * HOUR + 5 * HOUR,
      }),
    );
    const series = buildEnvelopeSeries(history, {
      providerKind: "kimi",
      metricId: "five-hour-coding",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
    });
    expect(series.policy).toBe("first-use");
    expect(series.spans.filter((window) => window.kind === "observed")).toHaveLength(4);
    expect(series.idleSpans.some((span) => span.kind === "unknown")).toBe(true);
  });

  test("keeps a jittered resetsAt inside the grid window that contains the reading", () => {
    const windowMs = 7 * DAY;
    const anchor = NOW;
    const history: UsageHistoryObservation[] = [];
    for (let day = 20; day >= 0; day -= 1) {
      const observedAt = NOW - day * DAY;
      const steps = Math.ceil((anchor - observedAt) / windowMs);
      const end = anchor - (steps - 1) * windowMs;
      const drift = ((day * 137) % 4_000) - 1_500;
      history.push(observation(observedAt, "weekly", 0.1 + (20 - day) * 0.01, {
        cadence: "calendar",
        durationMs: windowMs,
        resetsAt: end + drift,
      }));
    }
    const series = buildEnvelopeSeries(history, {
      providerKind: "claude",
      metricId: "weekly",
      now: NOW,
      rangeStart: NOW - 21 * DAY,
      rangeEnd: NOW,
    });
    const holding = series.spans.filter((window) =>
      window.readings.some((reading) => reading.observedAt >= window.start && reading.observedAt < window.end),
    );
    expect(holding.length).toBeGreaterThan(0);
    for (const window of holding) {
      expect(window.kind).toBe("observed");
    }
    for (const run of series.unknownRuns) {
      const inside = history.some((item) => item.observedAt >= run.start && item.observedAt < run.end);
      expect(inside).toBe(false);
    }
    const current = series.spans.find((window) => window.current);
    expect(current?.kind).toBe("observed");
    expect(current?.readings.length).toBeGreaterThan(0);
  });

  test("assigns the synthetic fixture without calling a populated window empty", () => {
    const weekly = REALISTIC_METERS.find((meter) => meter.metricId === "weekly")!;
    for (const hours of [48, 7 * 24, 30 * 24]) {
      const series = buildEnvelopeSeries(weekly.history, {
        providerKind: weekly.providerKind,
        metricId: weekly.metricId,
        now: FIXTURE_NOW,
        rangeStart: FIXTURE_NOW - hours * HOUR,
        rangeEnd: FIXTURE_NOW,
      });
      for (const window of series.spans) {
        if (window.readings.length > 0) expect(window.kind).toBe("observed");
      }
      for (const run of series.unknownRuns) {
        const overlap = series.spans.some((window) =>
          window.kind === "observed" &&
          window.readings.some((reading) => reading.observedAt >= run.start && reading.observedAt < run.end),
        );
        expect(overlap).toBe(false);
      }
    }
    const grok = REALISTIC_METERS.find((meter) => meter.metricId === "weekly-pool")!;
    const month = buildEnvelopeSeries(grok.history, {
      providerKind: "grok",
      metricId: "weekly-pool",
      now: FIXTURE_NOW,
      rangeStart: FIXTURE_NOW - 30 * DAY,
      rangeEnd: FIXTURE_NOW,
    });
    // The 4-day hole sits inside a weekly window that has readings on both
    // sides, so it is a possible-range band, not an empty window.
    const gap = month.spans
      .flatMap((window) => window.bands)
      .some((band) => !band.open && band.to - band.from > 3 * DAY);
    expect(gap).toBe(true);
  });

  test("builds a dense first-use series that goes idle when the metric is omitted", () => {
    const history: UsageHistoryObservation[] = [];
    for (let step = 0; step < 8; step += 1) {
      const at = NOW - (40 - step * 5) * HOUR;
      if (step >= 3 && step <= 5) {
        history.push(observation(at, "weekly", 0.2, { cadence: "calendar", durationMs: 7 * DAY, resetsAt: NOW + DAY }));
        continue;
      }
      history.push(observation(at, "five-hour", 0.15 + step * 0.02, {
        cadence: "rolling",
        durationMs: 5 * HOUR,
        resetsAt: at + 4 * HOUR,
      }));
    }
    const series = buildEnvelopeSeries(history, {
      providerKind: "claude",
      metricId: "five-hour",
      now: NOW,
      rangeStart: NOW - 48 * HOUR,
      rangeEnd: NOW,
      omittedObservations: history
        .filter((item) => !item.metrics.some((sample) => sample.metricId === "five-hour"))
        .map((item) => ({ observedAt: item.observedAt })),
    });
    expect(series.spans.filter((window) => window.kind === "observed").length).toBeGreaterThan(0);
    expect(series.idleSpans.some((span) => span.proofReadings > 0)).toBe(true);
  });

  test("covers the x range of every fixture meter at 48 h, 7 d, and 30 d", () => {
    const epsilon = 60 * 1_000;
    for (const meter of REALISTIC_METERS.filter((item) => item.history.length > 0)) {
      for (const hours of [48, 7 * 24, 30 * 24]) {
        const rangeStart = FIXTURE_NOW - hours * HOUR;
        const series = buildEnvelopeSeries(meter.history, {
          providerKind: meter.providerKind,
          metricId: meter.metricId,
          now: FIXTURE_NOW,
          rangeStart,
          rangeEnd: FIXTURE_NOW,
        });
        const first = series.spans
          .flatMap((window) => window.readings.map((reading) => reading.observedAt))
          .reduce<number | undefined>(
            (earliest, at) => earliest === undefined ? at : Math.min(earliest, at),
            undefined,
          );
        const from = Math.max(rangeStart, first ?? rangeStart);
        const gaps = uncoveredGaps(coverageSpans(series, rangeStart, FIXTURE_NOW), from, FIXTURE_NOW, epsilon);
        expect(gaps, `${meter.metricId} ${hours}h`).toEqual([]);
      }
    }
  });

  test("treats a 31-day to 30-day drop as a reset, not a mid-window rise", () => {
    const cursor = REALISTIC_METERS.find((meter) => meter.metricId === "other-models-monthly")!;
    const series = buildEnvelopeSeries(cursor.history, {
      providerKind: "cursor",
      metricId: "other-models-monthly",
      now: FIXTURE_NOW,
      rangeStart: FIXTURE_NOW - 30 * DAY,
      rangeEnd: FIXTURE_NOW,
    });
    expect(series.events.filter((event) => event.kind === "rebase")).toEqual([]);
    const observed = series.spans.filter((window) => window.kind === "observed");
    expect(observed.length).toBeGreaterThanOrEqual(2);
    const boundary = observed.find((window) =>
      window.readings.some((reading) => reading.durationMs === 30 * DAY),
    );
    expect(boundary?.readings.every((reading) => reading.durationMs === 30 * DAY)).toBe(true);
    const previous = observed.find((window) =>
      window.readings.length > 1 &&
      window.readings.every((reading) => reading.durationMs === 31 * DAY),
    );
    expect(previous).toBeDefined();
    expect(previous!.end).toBeLessThanOrEqual(boundary!.end);
  });

  test("still marks a rise that stays inside one reset key", () => {
    const resetsAt = NOW + 7 * DAY;
    const history = [
      observation(NOW - 3 * DAY, "weekly", 0.6, { cadence: "calendar", durationMs: 7 * DAY, resetsAt }),
      observation(NOW - 2 * DAY, "weekly", 0.1, { cadence: "calendar", durationMs: 7 * DAY, resetsAt }),
    ];
    const series = buildEnvelopeSeries(history, {
      providerKind: "claude",
      metricId: "weekly",
      now: NOW,
      rangeStart: NOW - 14 * DAY,
      rangeEnd: NOW,
    });
    expect(series.events.some((event) => event.kind === "rebase")).toBe(true);
    expect(sameResetKey(
      { observedAt: NOW - 3 * DAY, usedRatio: 0.6, left: 40, resetsAt, durationMs: 7 * DAY },
      { observedAt: NOW - 2 * DAY, usedRatio: 0.1, left: 90, resetsAt, durationMs: 7 * DAY },
    )).toBe(true);
    expect(sameResetKey(
      { observedAt: NOW - 3 * DAY, usedRatio: 0.6, left: 40, resetsAt, durationMs: 31 * DAY },
      { observedAt: NOW - 2 * DAY, usedRatio: 0.1, left: 90, resetsAt: resetsAt + 30 * DAY, durationMs: 30 * DAY },
    )).toBe(false);
  });
});
