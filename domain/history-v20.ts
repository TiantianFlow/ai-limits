import {
  buildEnvelopeSeries,
  type EnvelopeReading,
  type EnvelopeSeries,
  type WindowSpan,
} from "./history-envelope";
import type { DisplayMode, UsageHistoryObservation } from "./model";
import type { ProviderKind } from "./provider-kind";

/**
 * v20 drawing model. Windows still come from `buildEnvelopeSeries` (full stored
 * history, then clipped to the range). This module only decides what is drawn:
 * solid or dashed segments, the hold after the last reading, idle, gaps, bars.
 */

/** Windows at least this wide (px) are a line. Narrower ones are bars. */
export const LINE_MIN_WINDOW_PX = 24;
/** Below this (px) per window, sub-day windows group into one bar per day. */
export const BAR_MIN_WINDOW_PX = 6;
/** A connector is dashed only when it is wider than this (px) and the values differ. */
export const ESTIMATE_MIN_PX = 12;
/** Values within this many points are treated as equal. */
export const ESTIMATE_MIN_POINTS = 2;
/** A reading gets a dot only when both neighbours are farther than this (px). */
export const DOT_ISOLATION_PX = 12;
/** A gap shorter than this (px) is not marked under the axis. */
export const NO_DATA_MIN_PX = 3;
/** Reset ticks are drawn only for windows at least this long. */
export const RESET_TICK_MIN_HOURS = 24;
/** A window younger than this fraction of its length is not projected. */
export const PACE_MIN_ELAPSED = 0.15;
/** Bars with any usage are at least this tall. */
export const MIN_BAR_PX = 3;

export type ChartTier = "line" | "window-bars" | "day-bars";
export type SegmentStyle = "known" | "estimated";

export interface ChartPoint {
  at: number;
  /** Used percent, 0..100. */
  used: number;
  reading: boolean;
  dot?: boolean;
}

export interface ChartRun {
  id: string;
  points: ChartPoint[];
  styles: SegmentStyle[];
}

export interface ChartIdle {
  start: number;
  end: number;
  reason: "no-window" | "no-usage";
  lastReadingAt?: number;
}

export interface ChartGap {
  start: number;
  end: number;
}

export interface ChartWindow {
  id: string;
  start: number;
  end: number;
  current: boolean;
  readings: EnvelopeReading[];
  /** Used percent at each reading, monotone within the window. */
  values: number[];
  peak: number;
  tailKnown: boolean;
  windowMs: number;
}

export interface ChartBar {
  id: string;
  start: number;
  end: number;
  peak: number;
  tailKnown: boolean;
  readings: number;
  drawnWindows: number;
  busiest: ChartWindow | null;
  perDay: boolean;
  current: boolean;
}

export interface ChartModel {
  tier: ChartTier;
  rangeStart: number;
  rangeEnd: number;
  pxPerHour: number;
  drawnWindows: ChartWindow[];
  runs: ChartRun[];
  idle: ChartIdle[];
  gaps: ChartGap[];
  /** Reset times inside the range. Empty for windows shorter than a day. */
  resets: number[];
  bars: ChartBar[];
  readingsInRange: number;
  hasEstimated: boolean;
  windowMs: number;
}

export interface ChartBuildInput {
  history: readonly UsageHistoryObservation[];
  metricId: string;
  providerKind?: ProviderKind;
  now: number;
  rangeStart: number;
  rangeEnd: number;
  widthPx: number;
  omittedObservations?: readonly { observedAt: number }[];
}

export function chartTier(windowMs: number, rangeMs: number, widthPx: number): ChartTier {
  const day = 24 * 60 * 60 * 1_000;
  if (!(windowMs > 0) || windowMs > day) return "line";
  const px = (windowMs / Math.max(1, rangeMs)) * widthPx;
  if (px >= LINE_MIN_WINDOW_PX) return "line";
  if (px >= BAR_MIN_WINDOW_PX) return "window-bars";
  return "day-bars";
}

export function segmentStyle(dtMs: number, dv: number, pxPerMs: number): SegmentStyle {
  return Math.abs(dv) <= ESTIMATE_MIN_POINTS || dtMs * pxPerMs <= ESTIMATE_MIN_PX ? "known" : "estimated";
}

function usedPercent(reading: EnvelopeReading): number {
  return Math.min(100, Math.max(0, (1 - reading.left / 100) * 100));
}

function toWindow(span: WindowSpan): ChartWindow | null {
  if (span.kind !== "observed" || span.readings.length === 0) return null;
  const values = span.readings.map((reading) => usedPercent(reading));
  const peak = Math.max(...values);
  return {
    id: span.id,
    start: span.start,
    end: span.end,
    current: span.current,
    readings: span.readings,
    values,
    peak,
    tailKnown: span.tailTrusted,
    windowMs: span.windowMs,
  };
}

function markIsolated(points: ChartPoint[], pxPerMs: number): void {
  const indexes = points.map((point, index) => (point.reading ? index : -1)).filter((index) => index >= 0);
  indexes.forEach((index, place) => {
    const previous = indexes[place - 1];
    const next = indexes[place + 1];
    // An endpoint of a run with several readings is not isolated. A lone
    // reading, or one whose neighbours are both farther than the gap, is.
    if (indexes.length > 1 && (previous === undefined || next === undefined)) return;
    const before = previous === undefined ? Infinity : (points[index]!.at - points[previous]!.at) * pxPerMs;
    const after = next === undefined ? Infinity : (points[next]!.at - points[index]!.at) * pxPerMs;
    points[index]!.dot = before > DOT_ISOLATION_PX && after > DOT_ISOLATION_PX;
  });
}

/**
 * One run per window with usage. The last reading holds flat to the reset or
 * to now, whichever comes first, and a reset that has already happened drops
 * to 0% used (the refill in Left mode).
 */
export function buildRuns(windows: readonly ChartWindow[], now: number, pxPerMs: number): ChartRun[] {
  return windows.map((window) => {
    const points: ChartPoint[] = [];
    const styles: SegmentStyle[] = [];
    const first = window.readings[0]!;
    const last = window.readings[window.readings.length - 1]!;
    const lastUsed = window.values[window.values.length - 1]!;
    if (window.start < first.observedAt - 60_000) {
      points.push({ at: window.start, used: 0, reading: false });
      styles.push(segmentStyle(first.observedAt - window.start, window.values[0]!, pxPerMs));
    }
    window.readings.forEach((reading, index) => {
      if (index > 0) {
        const previous = window.readings[index - 1]!;
        styles.push(segmentStyle(
          reading.observedAt - previous.observedAt,
          window.values[index]! - window.values[index - 1]!,
          pxPerMs,
        ));
      }
      points.push({ at: reading.observedAt, used: window.values[index]!, reading: true });
    });
    const holdUntil = Math.min(window.end, now);
    if (holdUntil - last.observedAt > 60_000) {
      styles.push("estimated");
      points.push({ at: holdUntil, used: lastUsed, reading: false });
    }
    if (window.end <= now && window.end - last.observedAt > 60_000) {
      styles.push("known");
      points.push({ at: window.end, used: 0, reading: false });
    }
    markIsolated(points, pxPerMs);
    return { id: window.id, points, styles };
  });
}

function clipRun(run: ChartRun, rangeStart: number): ChartRun | null {
  const index = run.points.findIndex((point) => point.at >= rangeStart);
  if (index === -1) return null;
  if (index === 0) return run;
  const before = run.points[index - 1]!;
  const after = run.points[index]!;
  const span = after.at - before.at;
  const fraction = span > 0 ? (rangeStart - before.at) / span : 1;
  const edge: ChartPoint = {
    at: rangeStart,
    used: before.used + (after.used - before.used) * fraction,
    reading: false,
  };
  return {
    id: run.id,
    points: [edge, ...run.points.slice(index)],
    styles: [run.styles[index - 1] ?? "known", ...run.styles.slice(index)],
  };
}

function gapsOf(covered: { start: number; end: number }[], rangeStart: number, rangeEnd: number, minMs: number): ChartGap[] {
  const out: ChartGap[] = [];
  let cursor = rangeStart;
  for (const span of [...covered].sort((left, right) => left.start - right.start)) {
    const start = Math.max(span.start, rangeStart);
    if (start - cursor > minMs) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, Math.min(span.end, rangeEnd));
  }
  if (rangeEnd - cursor > minMs) out.push({ start: cursor, end: rangeEnd });
  return out;
}

function dayStart(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayBars(windows: readonly ChartWindow[], rangeStart: number, rangeEnd: number, now: number): ChartBar[] {
  const day = 24 * 60 * 60 * 1_000;
  const bars: ChartBar[] = [];
  for (let start = dayStart(rangeStart); start < rangeEnd; start += day) {
    const end = Math.min(start + day, rangeEnd);
    const inside = windows.filter((window) =>
      window.peak > 0 && window.start < end && window.end > Math.max(start, rangeStart),
    );
    if (inside.length === 0) continue;
    const busiest = inside.reduce((best, window) => (window.peak > best.peak ? window : best));
    bars.push({
      id: `day-${start}`,
      start: Math.max(start, rangeStart),
      end,
      peak: busiest.peak,
      tailKnown: busiest.tailKnown,
      readings: inside.reduce((sum, window) => sum + window.readings.length, 0),
      drawnWindows: inside.length,
      busiest,
      perDay: true,
      current: end >= now && start <= now,
    });
  }
  return bars.filter((bar) => bar.drawnWindows > 0);
}

function windowBars(windows: readonly ChartWindow[], rangeStart: number, rangeEnd: number): ChartBar[] {
  return windows
    .filter((window) => window.peak > 0 && window.end > rangeStart && window.start < rangeEnd)
    .map((window) => ({
      id: window.id,
      start: Math.max(window.start, rangeStart),
      end: Math.min(window.end, rangeEnd),
      peak: window.peak,
      tailKnown: window.tailKnown,
      readings: window.readings.length,
      drawnWindows: 1,
      busiest: window,
      perDay: false,
      current: window.current,
    }));
}

/**
 * Build the drawing model. Windows come from every stored reading, then only
 * the part inside the range is kept, so a window that started earlier carries
 * its value in from the left edge.
 */
export function buildChartModel(input: ChartBuildInput): ChartModel {
  const full: EnvelopeSeries = buildEnvelopeSeries(input.history, {
    ...(input.providerKind ? { providerKind: input.providerKind } : {}),
    metricId: input.metricId,
    now: input.now,
    rangeStart: 0,
    rangeEnd: input.rangeEnd,
    ...(input.omittedObservations ? { omittedObservations: input.omittedObservations } : {}),
  });
  const rangeMs = Math.max(1, input.rangeEnd - input.rangeStart);
  const pxPerMs = input.widthPx / rangeMs;
  const tier = chartTier(full.windowMs, rangeMs, input.widthPx);
  const windows = full.spans
    .map(toWindow)
    .filter((window): window is ChartWindow => window !== null && window.end > input.rangeStart);
  const drawnWindows = windows.filter((window) => window.peak > 0);
  const runs = buildRuns(drawnWindows, input.now, pxPerMs)
    .map((run) => clipRun(run, input.rangeStart))
    .filter((run): run is ChartRun => run !== null && run.points.length > 0);

  const idle: ChartIdle[] = [];
  for (const span of full.idleSpans) {
    if (span.end <= input.rangeStart || span.start >= input.rangeEnd) continue;
    if (span.kind === "idle") {
      idle.push({
        start: Math.max(span.start, input.rangeStart),
        end: Math.min(span.end, input.rangeEnd),
        reason: "no-window",
      });
    }
  }
  for (const span of full.spans) {
    const window = toWindow(span);
    if (!window || window.peak > 0) continue;
    if (window.end <= input.rangeStart || window.start >= input.rangeEnd) continue;
    idle.push({
      start: Math.max(window.start, input.rangeStart),
      end: Math.min(window.end, input.rangeEnd),
      reason: "no-usage",
      lastReadingAt: window.readings.at(-1)?.observedAt,
    });
  }

  const covered = [
    ...runs.map((run) => ({ start: run.points[0]!.at, end: run.points.at(-1)!.at })),
    ...idle.map((span) => ({ start: span.start, end: span.end })),
  ];
  const showResets = !(full.windowMs > 0) || full.windowMs >= RESET_TICK_MIN_HOURS * 60 * 60 * 1_000;
  const resets = showResets
    ? full.spans
      .map((span) => span.end)
      .filter((end) => end > input.rangeStart && end < input.rangeEnd)
    : [];
  const bars = tier === "window-bars"
    ? windowBars(windows, input.rangeStart, input.rangeEnd)
    : tier === "day-bars"
      ? dayBars(windows, input.rangeStart, input.rangeEnd, input.now)
      : [];
  const readingsInRange = full.spans
    .flatMap((span) => span.readings)
    .filter((reading) => reading.observedAt >= input.rangeStart && reading.observedAt <= input.rangeEnd)
    .length;

  return {
    tier,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    pxPerHour: pxPerMs * 60 * 60 * 1_000,
    drawnWindows,
    runs,
    idle,
    gaps: gapsOf(covered, input.rangeStart, input.rangeEnd, Math.max(60_000, NO_DATA_MIN_PX / pxPerMs)),
    resets: [...new Set(resets)],
    bars,
    readingsInRange,
    hasEstimated: runs.some((run) => run.styles.includes("estimated")),
    windowMs: full.windowMs,
  };
}

/** Whole-number headline. Values between 0 and 1 read as "<1". */
export function wholePercent(value: number): string {
  if (value > 0 && value < 1) return "<1";
  if (value > 99 && value < 100) return ">99";
  return String(Math.round(value));
}

export interface PaceInput {
  /** Latest reading of the window that contains now, when one exists. */
  currentUsed: number | undefined;
  /** When the current window started. */
  windowStart: number | undefined;
  /** When the current window resets. */
  resetsAt: number | undefined;
  now: number;
  mode: DisplayMode;
}

/**
 * One status line. Before 15% of the window has elapsed the line only names
 * the reset. After that it projects the average rate so far.
 */
export function paceLine(input: PaceInput): { shown: number; detailKey: string; detail: Record<string, string | number>; warn: boolean } {
  const used = input.currentUsed ?? 0;
  const shown = input.mode === "used" ? used : 100 - used;
  const when = input.resetsAt;
  if (when === undefined) {
    return { shown, detailKey: "history.paceNoWindow", detail: {}, warn: false };
  }
  const whenText = String(when);
  if (used >= 100) {
    return { shown, detailKey: "history.paceLimit", detail: { when: whenText }, warn: true };
  }
  if (used <= 0) {
    return { shown, detailKey: "history.paceNone", detail: { when: whenText }, warn: false };
  }
  const start = input.windowStart;
  if (start === undefined || when <= start) {
    return { shown, detailKey: "history.paceResets", detail: { when: whenText }, warn: false };
  }
  const elapsed = input.now - start;
  const fraction = elapsed / (when - start);
  if (fraction < PACE_MIN_ELAPSED || used < 1) {
    return { shown, detailKey: "history.paceResets", detail: { when: whenText }, warn: false };
  }
  const projected = used / fraction;
  if (projected >= 100) {
    const toFull = (elapsed * (100 - used)) / used;
    return {
      shown,
      detailKey: "history.paceRunOut",
      detail: { when: whenText, out: String(input.now + toFull) },
      warn: true,
    };
  }
  const rounded = Math.round(projected);
  return {
    shown,
    detailKey: input.mode === "used" ? "history.paceFor" : "history.paceLeft",
    detail: { when: whenText, percent: input.mode === "used" ? rounded : 100 - rounded },
    warn: false,
  };
}
