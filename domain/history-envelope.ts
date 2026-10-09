import type {
  MetricCycle,
  MetricHistorySample,
  UsageHistoryObservation,
} from "./model";
import type { ProviderKind } from "./provider-kind";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1_000;
/** Newest 48 h stay at the 15-minute collection cadence. */
export const RAW_RETENTION_MS = 48 * HOUR_MS;
const COLLECTION_INTERVAL_MS = 15 * MINUTE_MS;
const HOURLY_INTERVAL_MS = HOUR_MS;

/** Rises up to 1 percentage point are provider rounding and stay clamped. */
export const ROUNDING_TOLERANCE = 0.01;
export const ENVELOPE_MIN_WINDOW_PX = 24;
export const BAR_MIN_WINDOW_PX = 4;
export const TREND_MIN_WINDOWS = 6;
export const TREND_MIN_SPAN_FRACTION = 0.25;
/** Readings this close on screen are joined; farther ones stay dots. */
export const DOT_JOIN_PX = 6;
/** An open tail is never drawn longer than this. */
export const OPEN_STUB_PX = 10;
/** More rebase markers than this collapse into one legend note. */
export const REBASE_MARKER_CAP = 3;
/** Forward jump this large, relative to the cycle length, is a real reset. */
export const RESET_JUMP_FRACTION = 0.5;
/** Calendar cycles with no durationMs use this nominal length for the jump test. */
export const CALENDAR_NOMINAL_MS = 28 * DAY_MS;

export type WindowPolicy = "fixed" | "first-use";
export type DetailLevel = "envelope" | "bars" | "daily";

export interface MeterPolicy {
  providerKind: ProviderKind;
  metricId: string;
  /** Nominal window length. Calendar meters may still vary with the month. */
  windowMs: number;
  policy: WindowPolicy;
}

/**
 * Observed window policy. Generic fallback: calendar cadence, or a window of
 * at least 24 h, is a fixed grid; a shorter rolling window starts at first use.
 */
export const METER_POLICIES: readonly MeterPolicy[] = [
  { providerKind: "claude", metricId: "weekly", windowMs: 7 * DAY_MS, policy: "fixed" },
  { providerKind: "claude", metricId: "five-hour", windowMs: 5 * HOUR_MS, policy: "first-use" },
  { providerKind: "chatgpt", metricId: "30-day", windowMs: 30 * DAY_MS, policy: "first-use" },
  { providerKind: "chatgpt", metricId: "five-hour", windowMs: 5 * HOUR_MS, policy: "first-use" },
  { providerKind: "kimi", metricId: "five-hour-coding", windowMs: 5 * HOUR_MS, policy: "first-use" },
  { providerKind: "kimi", metricId: "weekly-coding", windowMs: 7 * DAY_MS, policy: "fixed" },
  { providerKind: "kimi", metricId: "monthly-total", windowMs: CALENDAR_NOMINAL_MS, policy: "fixed" },
  { providerKind: "cursor", metricId: "cursor-models-monthly", windowMs: 30 * DAY_MS, policy: "fixed" },
  { providerKind: "cursor", metricId: "other-models-monthly", windowMs: 30 * DAY_MS, policy: "fixed" },
  { providerKind: "cursor", metricId: "grok-bot-weekly", windowMs: 7 * DAY_MS, policy: "fixed" },
  { providerKind: "grok", metricId: "weekly-pool", windowMs: 7 * DAY_MS, policy: "fixed" },
  { providerKind: "grok", metricId: "2-hour-fast-queries", windowMs: 2 * HOUR_MS, policy: "first-use" },
  { providerKind: "grok", metricId: "2-hour-fast-tokens", windowMs: 2 * HOUR_MS, policy: "first-use" },
];

export function meterPolicy(
  providerKind: ProviderKind | undefined,
  metricId: string,
): MeterPolicy | undefined {
  return METER_POLICIES.find(
    (entry) => entry.providerKind === providerKind && entry.metricId === metricId,
  );
}

/** Cadence `calendar`, or a window of at least 24 h, is a fixed grid. */
export function fallbackPolicy(
  cadence: MetricCycle["cadence"] | undefined,
  windowMs: number | undefined,
): WindowPolicy {
  if (cadence === "calendar") return "fixed";
  if (windowMs !== undefined && windowMs >= DAY_MS) return "fixed";
  return "first-use";
}

export interface EnvelopeReading {
  observedAt: number;
  /** Quota used, 0..1. */
  usedRatio: number;
  /** Quota left, 0..100. */
  left: number;
  limit?: number;
  resetsAt?: number;
  durationMs?: number;
  cadence?: MetricCycle["cadence"];
  /** True when this observation of the instance omitted the metric. */
  omitted?: boolean;
}

export interface EnvelopeBand {
  from: number;
  to: number;
  /** Percent left. */
  upper: number;
  lower: number;
  event?: boolean;
  /**
   * Open tail. The first 10 px are a dotted stub; the rest of the tail is the
   * full possible range, drawn as a band rather than left blank.
   */
  open?: boolean;
}

export type HistoryEventKind = "limit-change" | "rebase";

export interface HistoryEventMarker {
  at: number;
  kind: HistoryEventKind;
}

export interface WindowSpan {
  id: string;
  start: number;
  end: number;
  current: boolean;
  kind: "observed" | "unknown";
  readings: EnvelopeReading[];
  bands: EnvelopeBand[];
  /** Clamped percent-left value at each reading. */
  values: number[];
  observedFirst: number | null;
  /** Lowest left seen after clamps and restarts. Certain usage is 100 − this. */
  observedMin: number | null;
  /** Trusted final left, or 0 when the tail is open. */
  endLower: number | null;
  tailTrusted: boolean;
  hasEvent: boolean;
  /** Window length used for this frame. */
  windowMs: number;
}

export interface IdleSpan {
  start: number;
  end: number;
  kind: "idle" | "unknown";
  proofReadings: number;
}

export interface TrendPoint {
  /** Window end. */
  at: number;
  /** End-of-window used percent. */
  used: number;
}

export interface TrendFit {
  /** Used-percent points per millisecond, time increasing toward now. */
  slope: number;
  intercept: number;
  originMs: number;
}

export interface WindowTrend {
  points: TrendPoint[];
  fit: TrendFit | null;
  needed: number;
  reason: "count" | "span" | null;
  minSpanMs: number;
}

export interface DayBucket {
  /** Local midnight that starts the day. */
  start: number;
  end: number;
  /** Busiest window that day, when one exists. */
  window: WindowSpan | null;
  today: boolean;
}

export interface EnvelopeSeries {
  policy: WindowPolicy;
  windowMs: number;
  spans: WindowSpan[];
  idleSpans: IdleSpan[];
  /** Merged runs of consecutive unknown fixed-grid windows. */
  unknownRuns: IdleSpan[];
  events: HistoryEventMarker[];
  /** True when rises were clamped because the rebase cap was hit. */
  rebaseCapped: boolean;
  trend: WindowTrend;
  readingsInRange: number;
}

export interface SeriesBuildOptions {
  providerKind?: ProviderKind;
  metricId: string;
  now: number;
  rangeStart: number;
  rangeEnd: number;
  /** Successful observations of this instance that omit the metric. */
  omittedObservations?: readonly { observedAt: number }[];
}

/** Expected spacing of a stored reading: 15 min while raw, 60 min once compacted. */
export function expectedIntervalMs(now: number, observedAt: number): number {
  return now - observedAt > RAW_RETENTION_MS
    ? HOURLY_INTERVAL_MS
    : COLLECTION_INTERVAL_MS;
}

/**
 * A reading counts as the window's final value when it falls within
 * `min(2 × expected collection interval, 25% of the window)`.
 */
export function tailToleranceMs(
  windowMs: number,
  now: number,
  observedAt: number,
): number {
  const doubled = 2 * expectedIntervalMs(now, observedAt);
  return Math.min(doubled, windowMs * 0.25);
}

export function detailLevel(
  windowMs: number,
  rangeMs: number,
  plotWidthPx: number,
): DetailLevel {
  const px = rangeMs <= 0 ? plotWidthPx : (windowMs / rangeMs) * plotWidthPx;
  // Wide enough for the staircase at any window length, including weekly
  // and monthly. A window of at least 24 h never drops to the per-day tier.
  if (px >= ENVELOPE_MIN_WINDOW_PX) return "envelope";
  if (px >= BAR_MIN_WINDOW_PX || windowMs >= DAY_MS) return "bars";
  return "daily";
}

/** Nominal length used when a cycle omits durationMs. Calendar → 28 days. */
export function nominalDurationMs(cycle: MetricCycle | undefined): number | undefined {
  if (cycle?.durationMs !== undefined && cycle.durationMs > 0) return cycle.durationMs;
  if (cycle?.cadence === "calendar") return CALENDAR_NOMINAL_MS;
  return undefined;
}

/**
 * A cycle change is a quota reset only when `resetsAt` jumps forward by at
 * least half the cycle length, or the duration/cadence changes and usage
 * drops. Without `durationMs`, a calendar cycle uses a 28-day nominal length,
 * and "resetsAt moved forward and usage dropped" is also a reset.
 * Millisecond jitter and slow rolling drift are not resets.
 * `next` is the newer cycle.
 */
export function cycleBoundaryChanged(
  next: MetricCycle | undefined,
  previous: MetricCycle | undefined,
  previousUsedRatio?: number,
  nextUsedRatio?: number,
): boolean {
  if (next === undefined || previous === undefined) return false;
  const usageKnown = previousUsedRatio !== undefined && nextUsedRatio !== undefined;
  const usageDropped = usageKnown && nextUsedRatio < previousUsedRatio;
  if (next.durationMs !== previous.durationMs || next.cadence !== previous.cadence) {
    if (usageDropped) return true;
  }
  if (next.resetsAt === undefined || previous.resetsAt === undefined) return false;
  const jump = next.resetsAt - previous.resetsAt;
  if (jump <= 0) return false;
  const duration = nominalDurationMs(next) ?? nominalDurationMs(previous);
  if (duration === undefined) {
    return usageDropped;
  }
  if (jump >= duration * RESET_JUMP_FRACTION) return true;
  // A calendar cycle stored without durationMs still resets when the boundary
  // moves and usage drops, even if the move is under half of 28 days.
  const undated = next.durationMs === undefined && previous.durationMs === undefined;
  return undated && next.cadence === "calendar" && usageDropped;
}

export function readingLeft(usedRatio: number): number {
  return Math.min(100, Math.max(0, (1 - usedRatio) * 100));
}

function quotaSample(
  observation: UsageHistoryObservation,
  metricId: string,
): Extract<MetricHistorySample, { type: "quota" }> | undefined {
  return observation.metrics.find(
    (candidate): candidate is Extract<MetricHistorySample, { type: "quota" }> =>
      candidate.type === "quota" && candidate.metricId === metricId,
  );
}

/** Quota readings for one meter, oldest first. Observations that omit it are absent. */
export function envelopeReadings(
  history: readonly UsageHistoryObservation[],
  metricId: string,
): EnvelopeReading[] {
  const readings: EnvelopeReading[] = [];
  for (const observation of [...history].sort(
    (left, right) => left.observedAt - right.observedAt,
  )) {
    const sample = quotaSample(observation, metricId);
    if (!sample) continue;
    readings.push({
      observedAt: observation.observedAt,
      usedRatio: sample.usedRatio,
      left: readingLeft(sample.usedRatio),
      ...(sample.limit === undefined ? {} : { limit: sample.limit }),
      ...(sample.cycle?.resetsAt === undefined ? {} : { resetsAt: sample.cycle.resetsAt }),
      ...(sample.cycle?.durationMs === undefined ? {} : { durationMs: sample.cycle.durationMs }),
      ...(sample.cycle?.cadence === undefined ? {} : { cadence: sample.cycle.cadence }),
    });
  }
  return readings;
}

interface WindowFrame {
  start: number;
  end: number;
  windowMs: number;
}

function frameKey(start: number, end: number): string {
  return `${start}:${end}`;
}

/**
 * Jitter and slow drift move `resetsAt` by milliseconds to a few seconds.
 * Two resets name the same window when they differ by less than half a window.
 */
export function sameWindowReset(left: number, right: number, windowMs: number): boolean {
  if (!(windowMs > 0)) return left === right;
  return Math.abs(left - right) < windowMs * 0.5;
}

/**
 * A reading stored a few milliseconds outside its window (reset jitter)
 * still belongs to that window. Drawing uses the clamped time.
 */
function clampReadingToFrame(reading: EnvelopeReading, frame: WindowFrame): EnvelopeReading {
  if (reading.observedAt >= frame.start && reading.observedAt < frame.end) return reading;
  const observedAt = Math.min(frame.end - 1, Math.max(frame.start, reading.observedAt));
  return { ...reading, observedAt };
}

/** Fixed-grid window that contains `at`, stepped back from `anchor`. */
export function gridFrameContaining(
  anchor: number,
  windowMs: number,
  at: number,
): WindowFrame {
  const steps = Math.ceil((anchor - at) / windowMs);
  const end = anchor - (steps - 1) * windowMs;
  return { start: end - windowMs, end, windowMs };
}

/**
 * Fixed-grid frames covering `[rangeStart, rangeEnd]`.
 * `anchor` is a known resetsAt; windows step backward and forward by `windowMs`.
 */
export function fixedGridFrames(
  anchor: number,
  windowMs: number,
  rangeStart: number,
  rangeEnd: number,
): WindowFrame[] {
  if (!(windowMs > 0) || !(rangeEnd > rangeStart)) return [];
  const stepsBack = Math.ceil((anchor - rangeStart) / windowMs);
  let end = anchor - stepsBack * windowMs;
  if (end <= rangeStart) end += windowMs;
  const frames: WindowFrame[] = [];
  for (; end - windowMs < rangeEnd; end += windowMs) {
    const start = end - windowMs;
    if (end <= rangeStart || start >= rangeEnd) continue;
    frames.push({ start, end, windowMs });
  }
  return frames;
}

function limitChanged(previous: number | undefined, current: number | undefined): boolean {
  return previous !== undefined && current !== undefined && previous !== current;
}

/**
 * Same window when both readings name one reset. A resetsAt jump past the
 * jitter tolerance, or a durationMs change, is a new window — never a
 * mid-window rise. A reading that omits resetsAt stays with its neighbor.
 */
export function sameResetKey(previous: EnvelopeReading, next: EnvelopeReading): boolean {
  if (previous.resetsAt === undefined || next.resetsAt === undefined) return true;
  const jump = Math.abs(next.resetsAt - previous.resetsAt);
  const tolerance = Math.max(
    5_000,
    0.02 * (previous.durationMs ?? next.durationMs ?? 0),
  );
  if (jump > tolerance) return false;
  if (
    previous.durationMs !== undefined &&
    next.durationMs !== undefined &&
    previous.durationMs !== next.durationMs &&
    jump > 60_000
  ) {
    return false;
  }
  return true;
}

/**
 * One monotone staircase. Left only falls inside a run; a rise above 1 pt or a
 * plan-limit change restarts it behind an amber marker. `clampRises` folds
 * every rise into the band instead, used once a window exceeds the marker cap.
 * A rise whose reset key changed is a window boundary, not a marker.
 */
export function buildWindowEnvelope(
  frame: WindowFrame,
  readings: readonly EnvelopeReading[],
  now: number,
  events: HistoryEventMarker[],
  clampRises = false,
): WindowSpan {
  const current = frame.end > now && frame.start <= now;
  const cutoff = current ? now : frame.end;
  const base = {
    id: frameKey(frame.start, frame.end),
    start: frame.start,
    end: frame.end,
    current,
    windowMs: frame.windowMs,
  };
  if (readings.length === 0) {
    return {
      ...base,
      kind: "unknown",
      readings: [],
      bands: [],
      values: [],
      observedFirst: null,
      observedMin: null,
      endLower: null,
      tailTrusted: false,
      hasEvent: false,
    };
  }

  const ordered = [...readings].sort((left, right) => left.observedAt - right.observedAt);
  const bands: EnvelopeBand[] = [];
  const values: number[] = [];
  let hasEvent = false;
  let prevValue = ordered[0]!.left;
  let runMin = prevValue;
  values.push(prevValue);
  bands.push({ from: frame.start, to: ordered[0]!.observedAt, upper: 100, lower: prevValue });

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const reading = ordered[index]!;
    const rose = !clampRises
      && sameResetKey(previous, reading)
      && reading.left > prevValue + ROUNDING_TOLERANCE * 100;
    const changed = limitChanged(previous.limit, reading.limit) && sameResetKey(previous, reading);
    if (changed || rose) {
      hasEvent = true;
      events.push({
        at: (previous.observedAt + reading.observedAt) / 2,
        kind: changed ? "limit-change" : "rebase",
      });
      bands.push({ from: previous.observedAt, to: reading.observedAt, upper: 100, lower: 0, event: true });
      prevValue = reading.left;
      runMin = reading.left;
    } else {
      const value = Math.min(reading.left, prevValue);
      bands.push({ from: previous.observedAt, to: reading.observedAt, upper: prevValue, lower: value });
      prevValue = value;
      runMin = Math.min(runMin, value);
    }
    values.push(prevValue);
  }

  const last = ordered[ordered.length - 1]!;
  const tolerance = tailToleranceMs(frame.windowMs, now, last.observedAt);
  const distance = current ? now - last.observedAt : frame.end - last.observedAt;
  const tailTrusted = distance <= tolerance;
  const endLower = tailTrusted ? prevValue : 0;
  if (last.observedAt < cutoff) {
    bands.push({
      from: last.observedAt,
      to: cutoff,
      // Untrusted: usage until the reset can be anything, so the range is the
      // whole scale. Trusted: the last value holds.
      upper: tailTrusted ? prevValue : 100,
      lower: endLower,
      open: !tailTrusted,
    });
  }

  return {
    ...base,
    kind: "observed",
    readings: ordered,
    bands,
    values,
    observedFirst: values[0] ?? null,
    observedMin: runMin,
    endLower,
    tailTrusted,
    hasEvent,
  };
}

/**
 * More than `REBASE_MARKER_CAP` rebase markers in one window are dropped.
 * Those rises are clamped into the staircase instead. Plan-limit markers stay.
 */
export function capRebaseMarkers(
  window: WindowSpan,
  events: readonly HistoryEventMarker[],
): { window: WindowSpan; events: HistoryEventMarker[]; capped: boolean } {
  const owned = events.filter((event) => event.at >= window.start && event.at <= window.end);
  const rebases = owned.filter((event) => event.kind === "rebase");
  if (rebases.length <= REBASE_MARKER_CAP) {
    return { window, events: owned, capped: false };
  }
  const kept = owned.filter((event) => event.kind !== "rebase");
  const clamped = buildWindowEnvelope(
    { start: window.start, end: window.end, windowMs: window.windowMs },
    window.readings,
    window.current ? window.end - 1 : window.end + window.windowMs,
    [],
    true,
  );
  return {
    window: { ...clamped, current: window.current, hasEvent: kept.length > 0 },
    events: kept,
    capped: true,
  };
}

/** Idle stretches between first-use windows. A stretch shorter than one window cannot hide one. */
export function idleSpansBetween(
  frames: readonly WindowFrame[],
  proofs: readonly EnvelopeReading[],
  windowMs: number,
  rangeStart: number,
  rangeEnd: number,
): IdleSpan[] {
  const ordered = [...frames].sort((left, right) => left.start - right.start);
  const spans: IdleSpan[] = [];
  let cursor = rangeStart;
  const push = (start: number, end: number): void => {
    if (end - start <= 1) return;
    const proofReadings = proofs.filter(
      (reading) => reading.observedAt >= start && reading.observedAt <= end,
    ).length;
    const kind = proofReadings > 0 || end - start < windowMs ? "idle" : "unknown";
    spans.push({ start, end, kind, proofReadings });
  };
  for (const frame of ordered) {
    if (frame.start > cursor) push(cursor, Math.min(frame.start, rangeEnd));
    cursor = Math.max(cursor, frame.end);
  }
  if (cursor < rangeEnd) push(cursor, rangeEnd);
  return spans;
}

/**
 * Consecutive unknown fixed-grid windows become one faint outline.
 * Windows that only touch at an edge, or overlap because a reading's own
 * duration differs from the grid step, still join one run.
 */
/**
 * X spans that cover the plot: every window, and every idle or unknown run.
 * Clipped to the range. Used to prove nothing between the first reading and
 * now is left blank.
 */
export function coverageSpans(
  series: EnvelopeSeries,
  rangeStart: number,
  rangeEnd: number,
): { from: number; to: number }[] {
  const raw = [
    ...series.spans.map((window) => ({ from: window.start, to: window.end })),
    ...series.unknownRuns.map((run) => ({ from: run.start, to: run.end })),
    ...series.idleSpans.map((span) => ({ from: span.start, to: span.end })),
  ];
  return raw.flatMap((span) => {
    const from = Math.max(rangeStart, Math.min(span.from, span.to));
    const to = Math.min(rangeEnd, Math.max(span.from, span.to));
    return to - from > 1 ? [{ from, to }] : [];
  });
}

/** Gaps wider than `epsilonMs` inside `[from, to]` that no span covers. */
export function uncoveredGaps(
  spans: readonly { from: number; to: number }[],
  from: number,
  to: number,
  epsilonMs: number,
): { from: number; to: number }[] {
  const ordered = [...spans]
    .filter((span) => span.to > from && span.from < to)
    .sort((left, right) => left.from - right.from);
  const gaps: { from: number; to: number }[] = [];
  let cursor = from;
  for (const span of ordered) {
    const start = Math.max(from, span.from);
    if (start - cursor > epsilonMs) gaps.push({ from: cursor, to: start });
    cursor = Math.max(cursor, Math.min(to, span.to));
  }
  if (to - cursor > epsilonMs) gaps.push({ from: cursor, to });
  return gaps;
}

export function mergeUnknownWindows(windows: readonly WindowSpan[]): IdleSpan[] {
  const unknown = windows
    .filter((window) => window.kind === "unknown")
    .sort((left, right) => left.start - right.start);
  const runs: IdleSpan[] = [];
  for (const window of unknown) {
    const run = runs.at(-1);
    if (run && window.start <= run.end) {
      run.end = Math.max(run.end, window.end);
      continue;
    }
    runs.push({ start: window.start, end: window.end, kind: "unknown", proofReadings: 0 });
  }
  return runs;
}

export function linearFit(
  points: readonly { x: number; y: number }[],
): { slope: number; intercept: number } | null {
  const count = points.length;
  if (count < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXX += point.x * point.x;
    sumXY += point.x * point.y;
  }
  const denominator = count * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 1e-9) return null;
  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  return { slope, intercept };
}

/**
 * OLS of end-of-window used percent against window end.
 * Eligible windows are complete, observed, tail-trusted, and event-free.
 */
export function windowTrend(
  windows: readonly WindowSpan[],
  rangeMs: number,
): WindowTrend {
  const points = windows
    .filter((window) =>
      !window.current &&
      window.kind === "observed" &&
      window.tailTrusted &&
      window.observedMin !== null &&
      !window.hasEvent,
    )
    .map((window) => ({ at: window.end, used: 100 - (window.observedMin ?? 0) }));
  const minSpanMs = rangeMs * TREND_MIN_SPAN_FRACTION;
  const span = points.length > 1
    ? points[points.length - 1]!.at - points[0]!.at
    : 0;
  const reason: WindowTrend["reason"] = points.length < TREND_MIN_WINDOWS
    ? "count"
    : span < minSpanMs
      ? "span"
      : null;
  const fit = reason
    ? null
    : linearFit(points.map((point) => ({ x: point.at - points[0]!.at, y: point.used })));
  return {
    points,
    fit: fit ? { ...fit, originMs: points[0]!.at } : null,
    needed: TREND_MIN_WINDOWS,
    reason,
    minSpanMs,
  };
}

export function predictUsed(fit: TrendFit, at: number): number {
  const used = fit.intercept + fit.slope * (at - fit.originMs);
  return Math.max(0, Math.min(100, used));
}

/** Certain usage for one window, plus whether the end is open. */
export function windowBar(
  window: WindowSpan,
): { certainUsed: number; open: boolean } | null {
  if (window.kind !== "observed" || window.observedMin === null) return null;
  return { certainUsed: 100 - window.observedMin, open: !window.tailTrusted };
}

function localMidnight(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function nextLocalMidnight(midnight: number): number {
  const date = new Date(midnight);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/**
 * One bar per local day: the day's busiest window.
 * Highest certain usage wins; a trusted end wins a tie.
 */
export function dailyBuckets(
  windows: readonly WindowSpan[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
): DayBucket[] {
  const buckets: DayBucket[] = [];
  let cursor = localMidnight(rangeStart);
  const today = localMidnight(now);
  while (cursor < rangeEnd) {
    const end = nextLocalMidnight(cursor);
    const candidates = windows.filter(
      (window) => window.kind === "observed" && window.start >= cursor && window.start < end,
    );
    const window = candidates.reduce<WindowSpan | null>((best, candidate) => {
      if (!best) return candidate;
      const usage = (item: WindowSpan) => 100 - (item.observedMin ?? 100);
      if (usage(candidate) > usage(best) + 1e-9) return candidate;
      if (Math.abs(usage(candidate) - usage(best)) <= 1e-9 && candidate.tailTrusted && !best.tailTrusted) {
        return candidate;
      }
      return best;
    }, null);
    buckets.push({ start: cursor, end, window, today: cursor === today });
    cursor = end;
  }
  return buckets;
}

/**
 * A first-use reading of 0% used whose resetsAt sits about one window after
 * the observation is "no active window", not a member of a sliding window.
 */
export function isIdleProofReading(
  reading: EnvelopeReading,
  windowMs: number,
  now: number,
): boolean {
  if (reading.usedRatio !== 0 || reading.resetsAt === undefined) return false;
  const slack = 2 * expectedIntervalMs(now, reading.observedAt);
  return Math.abs(reading.resetsAt - (reading.observedAt + windowMs)) <= slack;
}

function resolvePolicy(
  options: SeriesBuildOptions,
  readings: readonly EnvelopeReading[],
): { policy: WindowPolicy; windowMs: number } {
  const listed = meterPolicy(options.providerKind, options.metricId);
  const withDuration = readings.find((reading) => reading.durationMs !== undefined && reading.durationMs > 0);
  const cadence = readings.find((reading) => reading.cadence)?.cadence;
  const windowMs = listed?.windowMs
    ?? withDuration?.durationMs
    ?? (cadence === "calendar" ? CALENDAR_NOMINAL_MS : 0);
  const policy = listed?.policy ?? fallbackPolicy(cadence, windowMs || undefined);
  return { policy, windowMs };
}

/**
 * Group readings that name the same window.
 * On a fixed grid, membership is the window that contains `observedAt`
 * (jittered `resetsAt` is only a hint). First-use readings cluster when
 * their `resetsAt` values sit within half a window of each other.
 * A fixed reading whose own `resetsAt` sits on a different grid (a 31-day
 * month against a 30-day step) keeps that window instead of being folded
 * into the nominal grid.
 */
function groupReadings(
  readings: readonly EnvelopeReading[],
  policy: WindowPolicy,
  windowMs: number,
  anchor: number | undefined,
): Map<number, EnvelopeReading[]> {
  const groups = new Map<number, EnvelopeReading[]>();
  const put = (end: number, reading: EnvelopeReading): void => {
    const group = groups.get(end) ?? [];
    group.push(reading);
    groups.set(end, group);
  };
  for (const reading of readings) {
    if (reading.resetsAt === undefined) continue;
    if (policy === "fixed" && anchor !== undefined && windowMs > 0) {
      const frame = gridFrameContaining(anchor, windowMs, reading.observedAt);
      const ownLength = reading.durationMs && reading.durationMs > 0 ? reading.durationMs : windowMs;
      const ownStart = reading.resetsAt - ownLength;
      const namesOwnWindow = Math.abs(reading.resetsAt - frame.end) > 60_000
        && reading.observedAt >= ownStart
        && reading.observedAt < reading.resetsAt;
      if (!namesOwnWindow && reading.observedAt >= frame.start && reading.observedAt < frame.end) {
        put(frame.end, reading);
      } else if (namesOwnWindow) {
        let matched: number | undefined;
        for (const end of groups.keys()) {
          if (Math.abs(end - reading.resetsAt) < 60_000 || sameWindowReset(end, reading.resetsAt, ownLength)) {
            matched = end;
            break;
          }
        }
        // Key by the snapped grid boundary when this reset is only jitter away
        // from it, so the reading lands in the frame built for that boundary.
        const snapped = matched !== undefined && Math.abs(matched - reading.resetsAt) < 60_000
          ? matched
          : reading.resetsAt;
        put(snapped, reading);
      } else if (reading.observedAt >= frame.start && reading.observedAt < frame.end) {
        put(frame.end, reading);
      }
      continue;
    }
    if (!(windowMs > 0)) {
      put(reading.resetsAt, reading);
      continue;
    }
    let matched: number | undefined;
    for (const end of groups.keys()) {
      if (sameWindowReset(end, reading.resetsAt, windowMs)) {
        matched = end;
        break;
      }
    }
    put(matched ?? reading.resetsAt, reading);
  }
  return groups;
}

/**
 * Fixed grid plus any window a reading names with its own resetsAt.
 * A duration change (31 days, then 30) or a reset that is not a multiple of
 * the nominal step still gets a frame, so the range is not left blank.
 */
function framesForFixed(
  anchor: number,
  windowMs: number,
  rangeStart: number,
  rangeEnd: number,
  readings: readonly EnvelopeReading[],
): WindowFrame[] {
  const frames = fixedGridFrames(anchor, windowMs, rangeStart, rangeEnd);
  for (const reading of readings) {
    const resetsAt = reading.resetsAt;
    if (resetsAt === undefined) continue;
    const length = reading.durationMs && reading.durationMs > 0 ? reading.durationMs : windowMs;
    if (!(length > 0)) continue;
    const gridEnds = frames.flatMap((frame) => [frame.end, frame.start]);
    const gridEnd = gridEnds.find((at) => Math.abs(at - resetsAt) < 60_000);
    const end = gridEnd ?? resetsAt;
    const start = end - length;
    if (end <= rangeStart || start >= rangeEnd) continue;
    if (frames.some((frame) => sameWindowReset(frame.end, end, length))) continue;
    // A named reset a few seconds off the grid is the grid window, not a
    // second frame. Anything farther (a 31-day month on a 30-day step) is new.
    const nearGrid = frames.some((frame) => Math.abs(frame.end - end) < 60_000);
    if (nearGrid) continue;
    frames.push({ start, end, windowMs: length });
  }
  return frames;
}

/**
 * Readings with no resetsAt. Fixed meters join the grid window containing
 * observedAt when an anchor exists. First-use: used 0 is an idle proof;
 * otherwise one open window of unknown start ending at observedAt + window length.
 */
function migrateUnanchored(
  readings: readonly EnvelopeReading[],
  policy: WindowPolicy,
  windowMs: number,
  anchor: number | undefined,
): { assigned: Map<number, EnvelopeReading[]>; synthetic: WindowFrame[]; proofs: EnvelopeReading[] } {
  const assigned = new Map<number, EnvelopeReading[]>();
  const synthetic: WindowFrame[] = [];
  const proofs: EnvelopeReading[] = [];
  for (const reading of readings) {
    if (reading.resetsAt !== undefined) continue;
    if (policy === "fixed" && anchor !== undefined && windowMs > 0) {
      const frame = gridFrameContaining(anchor, windowMs, reading.observedAt);
      if (reading.observedAt >= frame.start && reading.observedAt < frame.end) {
        const group = assigned.get(frame.end) ?? [];
        group.push(reading);
        assigned.set(frame.end, group);
      }
      continue;
    }
    if (reading.usedRatio === 0) {
      proofs.push({ ...reading, omitted: true });
      continue;
    }
    if (windowMs > 0) {
      synthetic.push({
        start: reading.observedAt,
        end: reading.observedAt + windowMs,
        windowMs,
      });
    }
  }
  return { assigned, synthetic, proofs };
}

/** Split a frame where consecutive readings name different resets. */
function splitFrameByReset(
  frame: WindowFrame,
  readings: readonly EnvelopeReading[],
): { frame: WindowFrame; readings: EnvelopeReading[] }[] {
  const ordered = [...readings].sort((left, right) => left.observedAt - right.observedAt);
  if (ordered.length === 0) return [{ frame, readings: [] }];
  const pieces: EnvelopeReading[][] = [[ordered[0]!]];
  for (let index = 1; index < ordered.length; index += 1) {
    const reading = ordered[index]!;
    const previous = pieces.at(-1)!.at(-1)!;
    if (sameResetKey(previous, reading)) pieces.at(-1)!.push(reading);
    else pieces.push([reading]);
  }
  if (pieces.length === 1) return [{ frame, readings: ordered }];
  const split = pieces.flatMap((piece, index) => {
    const first = piece[0]!;
    const last = piece.at(-1)!;
    const next = pieces[index + 1]?.[0];
    const length = first.durationMs && first.durationMs > 0 ? first.durationMs : frame.windowMs;
    const namedEnd = last.resetsAt;
    const start = index === 0
      ? frame.start
      : namedEnd !== undefined ? Math.max(frame.start, namedEnd - length) : first.observedAt;
    const end = next
      ? next.observedAt
      : namedEnd !== undefined && namedEnd > last.observedAt ? Math.min(frame.end, namedEnd) : frame.end;
    const clampedStart = Math.max(frame.start, start);
    const clampedEnd = Math.max(last.observedAt + 1, Math.min(frame.end, end));
    // Jitter can leave a sliver of the parent frame. Those readings stay on
    // the parent rather than becoming a window a few milliseconds wide.
    if (clampedEnd - clampedStart < 60_000) return [];
    return [{
      frame: { start: clampedStart, end: clampedEnd, windowMs: length },
      readings: piece,
    }];
  });
  if (split.length === pieces.length) return split;
  const kept = new Set(split.flatMap((piece) => piece.readings));
  const returned = ordered.filter((reading) => !kept.has(reading));
  if (returned.length === 0) return split;
  return [{ frame, readings: returned }, ...split];
}

/**
 * Anything from the first in-range reading to now that no window covers
 * becomes an unknown outline. A fixed window that was never emitted (its
 * reset was missing, or it sat between two differently keyed windows) must
 * not render as empty paper.
 */
function fillUncovered(
  frames: readonly WindowFrame[],
  rangeStart: number,
  rangeEnd: number,
  firstReadingAt: number | undefined,
): WindowFrame[] {
  const extra: WindowFrame[] = [];
  const coverFrom = firstReadingAt === undefined
    ? rangeStart
    : Math.max(rangeStart, firstReadingAt);
  const ordered = [...frames]
    .filter((frame) => frame.end > coverFrom && frame.start < rangeEnd)
    .sort((left, right) => left.start - right.start);
  let cursor = coverFrom;
  const push = (start: number, end: number): void => {
    if (end - start <= 1) return;
    extra.push({ start, end, windowMs: end - start });
  };
  for (const frame of ordered) {
    if (frame.start > cursor) push(cursor, Math.min(frame.start, rangeEnd));
    cursor = Math.max(cursor, frame.end);
  }
  if (cursor < rangeEnd) push(cursor, rangeEnd);
  return extra;
}

function latestAnchor(readings: readonly EnvelopeReading[]): number | undefined {
  let anchor: number | undefined;
  for (const reading of readings) {
    if (reading.resetsAt === undefined) continue;
    if (anchor === undefined || reading.resetsAt > anchor) anchor = reading.resetsAt;
  }
  return anchor;
}

export function buildEnvelopeSeries(
  history: readonly UsageHistoryObservation[],
  options: SeriesBuildOptions,
): EnvelopeSeries {
  const all = envelopeReadings(history, options.metricId);
  const { policy, windowMs } = resolvePolicy(options, all);
  const rangeStart = options.rangeStart;
  const rangeEnd = options.rangeEnd;
  const inRange = (reading: EnvelopeReading) =>
    reading.observedAt >= rangeStart && reading.observedAt <= rangeEnd;
  const visible = all.filter(inRange);
  const anchor = latestAnchor(all.filter((reading) => reading.observedAt <= rangeEnd));
  const migrated = migrateUnanchored(visible, policy, windowMs, anchor);

  // Jitter gives every reading its own resetsAt. Cluster ones within a minute
  // onto the earliest of the cluster so they name one window.
  const resetKeys = [...new Set(visible.flatMap((reading) => reading.resetsAt === undefined ? [] : [reading.resetsAt]))].sort((left, right) => left - right);
  const canonical = new Map<number, number>();
  let cluster = resetKeys[0];
  for (const key of resetKeys) {
    if (cluster === undefined || key - cluster > 60_000) cluster = key;
    canonical.set(key, cluster ?? key);
  }
  for (const reading of visible) {
    if (reading.resetsAt === undefined) continue;
    const snapped = canonical.get(reading.resetsAt);
    if (snapped !== undefined) reading.resetsAt = snapped;
  }

  const members = visible.filter((reading) => {
    if (reading.resetsAt === undefined) return false;
    if (policy === "first-use" && isIdleProofReading(reading, windowMs, options.now)) return false;
    return true;
  });
  const idleProofs = [
    ...visible.filter((reading) =>
      policy === "first-use" && isIdleProofReading(reading, windowMs, options.now),
    ),
    ...migrated.proofs,
    ...(options.omittedObservations ?? [])
      .filter((observation) =>
        observation.observedAt >= rangeStart && observation.observedAt <= rangeEnd,
      )
      .map((observation) => ({
        observedAt: observation.observedAt,
        usedRatio: 0,
        left: 100,
        omitted: true,
      })),
  ];

  const frames: WindowFrame[] = [];
  const fixedGrid = policy === "fixed" && windowMs > 0 && anchor !== undefined;
  if (fixedGrid && anchor !== undefined) {
    frames.push(...framesForFixed(anchor, windowMs, rangeStart, rangeEnd, members));
  }
  const grouped = groupReadings(members, policy, windowMs, anchor);
  if (fixedGrid) {
    const boundaries = frames.flatMap((frame) => [frame.start, frame.end]);
    for (const key of [...grouped.keys()]) {
      const snapped = boundaries.find((at) => at !== key && Math.abs(at - key) < 60_000);
      if (snapped === undefined) continue;
      const moving = grouped.get(key) ?? [];
      grouped.delete(key);
      grouped.set(snapped, [...(grouped.get(snapped) ?? []), ...moving]);
    }
  }
  if (!fixedGrid) {
    for (const [end, group] of grouped) {
      const known = group.find((reading) => reading.durationMs && reading.durationMs > 0);
      const length = known?.durationMs ?? windowMs;
      if (!(length > 0)) continue;
      const start = end - length;
      if (!frames.some((frame) => sameWindowReset(frame.end, end, length))) {
        frames.push({ start, end, windowMs: length });
      }
    }
  }
  for (const [end, group] of migrated.assigned) {
    if (!frames.some((frame) => frame.end === end || sameWindowReset(frame.end, end, windowMs))) {
      frames.push({ start: end - windowMs, end, windowMs });
    }
    const existing = grouped.get(end) ?? [];
    grouped.set(end, [...existing, ...group]);
  }
  for (const frame of migrated.synthetic) {
    frames.push(frame);
    const group = grouped.get(frame.end) ?? [];
    const reading = visible.find(
      (candidate) =>
        candidate.resetsAt === undefined &&
        candidate.usedRatio !== 0 &&
        candidate.observedAt === frame.start,
    );
    if (reading) grouped.set(frame.end, [...group, reading]);
  }

  const deduped = [...new Map(frames.map((frame) => [frameKey(frame.start, frame.end), frame])).values()]
    .filter((frame) => frame.end > rangeStart && frame.start < rangeEnd);
  // A named window (31 days) replaces the nominal grid frame it covers,
  // including a grid frame that shares its end but starts later.
  const named = deduped.filter((frame) => frame.windowMs !== windowMs);
  const unique = deduped
    .filter((frame) => !named.some((other) =>
      other !== frame &&
      frame.start >= other.start - 120_000 &&
      frame.end <= other.end + 120_000,
    ))
    .sort((left, right) => left.start - right.start || right.end - left.end);

  // A reading's own window can overlap the nominal grid. The window that
  // actually names the reading wins; the grid frame keeps the rest.
  const claimed = new Set<EnvelopeReading>();
  const assignedToFrame = new Map<string, EnvelopeReading[]>();
  const claimOrder = [...unique].sort((left, right) => {
    const names = (frame: WindowFrame) =>
      (grouped.get(frame.end) ?? []).some((reading) => reading.resetsAt === frame.end);
    if (names(left) !== names(right)) return names(left) ? -1 : 1;
    return left.start - right.start;
  });
  for (const frame of claimOrder) {
    const kept = (grouped.get(frame.end) ?? []).filter((reading) => {
      if (claimed.has(reading)) return false;
      if (reading.observedAt < frame.start - 60_000 || reading.observedAt >= frame.end + 60_000) return false;
      claimed.add(reading);
      return true;
    });
    assignedToFrame.set(frameKey(frame.start, frame.end), kept);
  }
  // A grid frame a named window already covers can be left with nothing, or
  // with a single reading the jitter pushed across the boundary. Drop it.
  for (const frame of [...unique]) {
    const own = assignedToFrame.get(frameKey(frame.start, frame.end)) ?? [];
    const covered = named.some((other) =>
      other !== frame &&
      frame.start >= other.start - 120_000 &&
      frame.end <= other.end + 120_000,
    );
    if (covered && own.length <= 1) {
      const index = unique.indexOf(frame);
      if (index >= 0) unique.splice(index, 1);
    }
  }

  const events: HistoryEventMarker[] = [];
  let rebaseCapped = false;
  const pieces = unique.flatMap((frame) => {
    const readings = (assignedToFrame.get(frameKey(frame.start, frame.end)) ?? [])
      .filter((reading) => reading.observedAt < frame.end + 60_000)
      .map((reading) => clampReadingToFrame(reading, frame));
    return splitFrameByReset(frame, readings);
  });
  const firstReadingAt = visible.reduce<number | undefined>(
    (earliest, reading) => earliest === undefined
      ? reading.observedAt
      : Math.min(earliest, reading.observedAt),
    undefined,
  );
  const covered = pieces.map((piece) => piece.frame);
  const fillers = policy === "fixed"
    ? fillUncovered(covered, rangeStart, rangeEnd, firstReadingAt)
    : [];
  for (const frame of fillers) pieces.push({ frame, readings: [] });

  const windows = pieces.map((piece) => {
    const draft: HistoryEventMarker[] = [];
    const built = buildWindowEnvelope(piece.frame, piece.readings, options.now, draft);
    const capped = capRebaseMarkers(built, draft);
    if (capped.capped) rebaseCapped = true;
    events.push(...capped.events);
    return capped.window;
  });

  const idle = policy === "first-use"
    ? idleSpansBetween(
        windows.filter((window) => window.kind === "observed"),
        idleProofs,
        windowMs,
        rangeStart,
        rangeEnd,
      )
    : [];

  return {
    policy,
    windowMs,
    spans: windows,
    idleSpans: idle,
    unknownRuns: policy === "fixed" ? mergeUnknownWindows(windows) : [],
    events,
    rebaseCapped,
    trend: windowTrend(windows, rangeEnd - rangeStart),
    readingsInRange: visible.length,
  };
}

/** Per-meter last observation before each window boundary, keyed by hour bucket. */
export function boundaryKeepers(
  history: readonly UsageHistoryObservation[],
): Set<number> {
  const keep = new Set<number>();
  const metricIds = new Set<string>();
  for (const observation of history) {
    for (const sample of observation.metrics) {
      if (sample.type === "quota") metricIds.add(sample.metricId);
    }
  }
  for (const metricId of metricIds) {
    const readings = envelopeReadings(history, metricId);
    let previous: EnvelopeReading | undefined;
    for (const reading of readings) {
      if (previous && cycleBoundaryChanged(
        {
          ...(reading.resetsAt === undefined ? {} : { resetsAt: reading.resetsAt }),
          ...(reading.durationMs === undefined ? {} : { durationMs: reading.durationMs }),
          ...(reading.cadence === undefined ? {} : { cadence: reading.cadence }),
        },
        {
          ...(previous.resetsAt === undefined ? {} : { resetsAt: previous.resetsAt }),
          ...(previous.durationMs === undefined ? {} : { durationMs: previous.durationMs }),
          ...(previous.cadence === undefined ? {} : { cadence: previous.cadence }),
        },
        previous.usedRatio,
        reading.usedRatio,
      )) {
        keep.add(previous.observedAt);
      }
      previous = reading;
    }
  }
  return keep;
}
