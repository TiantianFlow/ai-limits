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
  /** Open tail: a short stub, not a fill to the floor. */
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
 * One monotone staircase. Left only falls inside a run; a rise above 1 pt or a
 * plan-limit change restarts it behind an amber marker. `clampRises` folds
 * every rise into the band instead, used once a window exceeds the marker cap.
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
    const rose = !clampRises && reading.left > prevValue + ROUNDING_TOLERANCE * 100;
    const changed = limitChanged(previous.limit, reading.limit);
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
      upper: prevValue,
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
      if (reading.observedAt >= frame.start && reading.observedAt < frame.end) {
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
    frames.push(...fixedGridFrames(anchor, windowMs, rangeStart, rangeEnd));
  }
  const grouped = groupReadings(members, policy, windowMs, anchor);
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

  const unique = [...new Map(frames.map((frame) => [frameKey(frame.start, frame.end), frame])).values()]
    .filter((frame) => frame.end > rangeStart && frame.start < rangeEnd)
    .sort((left, right) => left.start - right.start);

  const events: HistoryEventMarker[] = [];
  let rebaseCapped = false;
  const windows = unique.map((frame) => {
    const readings = (grouped.get(frame.end) ?? [])
      .filter((reading) => reading.observedAt >= frame.start && reading.observedAt < frame.end)
      .map((reading) => clampReadingToFrame(reading, frame));
    const draft: HistoryEventMarker[] = [];
    const built = buildWindowEnvelope(frame, readings, options.now, draft);
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
