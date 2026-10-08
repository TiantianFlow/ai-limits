import type {
  MetricCycle,
  MetricHistorySample,
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";

const HOUR_MS = 60 * 60 * 1_000;
const RAW_RETENTION_MS = 48 * HOUR_MS;
const MAX_RETENTION_MS = 30 * 24 * HOUR_MS;
const MAX_OBSERVATIONS = 1_024;
/**
 * Scheduled refresh is about every 15 minutes
 * (`REFRESH_PERIOD_MINUTES` in the background entry). Older than 48 h is
 * compacted to one sample per hour.
 */
const COLLECTION_INTERVAL_MS = 15 * 60 * 1_000;
const HOURLY_INTERVAL_MS = HOUR_MS;
/** A hole this many expected intervals wide (or wider) can be a long gap. */
const GAP_INTERVAL_MULTIPLIER = 4;
/** Short misses wider than this many expected intervals count as bridged reads. */
const BRIDGE_INTERVAL_FACTOR = 1.5;
const MANY_SEGMENTS = 8;

export interface MetricHistoryPoint {
  observedAt: number;
  usedRatio: number;
}

function isFreshlyObserved(
  metric: { observedAt?: number },
  fetchedAt: number,
): boolean {
  return metric.observedAt === undefined || metric.observedAt === fetchedAt;
}

function historySample(
  metric: UsageSnapshot["metrics"][number],
): MetricHistorySample {
  switch (metric.type) {
    case "quota":
      return {
        metricId: metric.id,
        type: metric.type,
        usedRatio: metric.usedRatio,
        ...(metric.limit === undefined ? {} : { limit: metric.limit }),
        ...(metric.cycle === undefined
          ? {}
          : { cycle: historyCycle(metric.cycle) }),
      };
    case "counter":
      return {
        metricId: metric.id,
        type: metric.type,
        semantic: metric.semantic,
        value: metric.value,
        unit: metric.unit,
        ...(metric.limit === undefined ? {} : { limit: metric.limit }),
        ...(metric.cycle === undefined
          ? {}
          : { cycle: historyCycle(metric.cycle) }),
      };
    case "balance":
      return {
        metricId: metric.id,
        type: metric.type,
        value: metric.value,
        unit: metric.unit,
        ...(metric.initialLimit === undefined
          ? {}
          : { initialLimit: metric.initialLimit }),
        ...(metric.cycle === undefined
          ? {}
          : { cycle: historyCycle(metric.cycle) }),
      };
  }
}

export function observationFromUsage(
  snapshot: UsageSnapshot,
): UsageHistoryObservation {
  return {
    observedAt: snapshot.fetchedAt,
    metrics: snapshot.metrics.flatMap((metric) =>
      isFreshlyObserved(metric, snapshot.fetchedAt) ? [historySample(metric)] : [],
    ),
  };
}

function historyCycle(cycle: MetricCycle): MetricCycle {
  return {
    ...(cycle.cadence === undefined ? {} : { cadence: cycle.cadence }),
    ...(cycle.startedAt === undefined ? {} : { startedAt: cycle.startedAt }),
    ...(cycle.resetsAt === undefined ? {} : { resetsAt: cycle.resetsAt }),
    ...(cycle.durationMs === undefined ? {} : { durationMs: cycle.durationMs }),
  };
}

export function appendUsageObservation(
  history: readonly UsageHistoryObservation[],
  snapshot: UsageSnapshot,
): UsageHistoryObservation[] {
  return retainUsageHistory(
    [...history, observationFromUsage(snapshot)],
    snapshot.fetchedAt,
  );
}

export function retainUsageHistory(
  history: readonly UsageHistoryObservation[],
  referenceAt: number,
): UsageHistoryObservation[] {
  return retainHistory(history, referenceAt);
}

function retainHistory<T extends { observedAt: number }>(
  history: readonly T[],
  referenceAt: number,
): T[] {
  const byTimestamp = new Map<number, T>();
  for (const observation of history) {
    byTimestamp.set(observation.observedAt, observation);
  }

  const cutoff = referenceAt - MAX_RETENTION_MS;
  const rawCutoff = referenceAt - RAW_RETENTION_MS;
  const ordered = [...byTimestamp.values()]
    .filter(({ observedAt }) => observedAt >= cutoff)
    .sort((left, right) => left.observedAt - right.observedAt);
  const compacted = new Map<number, T>();
  const raw: T[] = [];

  for (const observation of ordered) {
    if (observation.observedAt >= rawCutoff) {
      raw.push(observation);
      continue;
    }

    compacted.set(
      Math.floor(observation.observedAt / HOUR_MS),
      observation,
    );
  }

  return [...compacted.values(), ...raw].slice(-MAX_OBSERVATIONS);
}

export function quotaHistorySegments(
  history: readonly UsageHistoryObservation[],
  metricId: string,
  options?: { rangeHours?: number; now?: number },
): MetricHistoryPoint[][] {
  return quotaHistorySeries(history, metricId, options).segments.map((segment) =>
    segment.points.map((point) => ({
      observedAt: point.observedAt,
      usedRatio: point.usedRatio,
    })),
  );
}

export interface QuotaHistoryPoint extends MetricHistoryPoint {
  limit?: number;
  cycle?: MetricCycle;
}

export type HistoryBreakKind = "reset" | "gap" | "limit-change";

export interface QuotaHistorySegment {
  points: QuotaHistoryPoint[];
  /** Why the series is broken before this segment starts. */
  breakBefore?: HistoryBreakKind;
}

export interface HistoryGap {
  from: number;
  to: number;
  labelHours: number;
}

export interface TrendLine {
  from: number;
  to: number;
  fromRatio: number;
  toRatio: number;
}

export interface QuotaHistorySeries {
  segments: QuotaHistorySegment[];
  gaps: HistoryGap[];
  resets: number[];
  limitChanges: number[];
  trends: TrendLine[];
  /** Missed samples shorter than the gap threshold that the line bridges. */
  bridgedSamples: number;
  /** Shade only holes longer than this. */
  gapThresholdMs: number;
}

export interface QuotaHistorySeriesOptions {
  /** Active chart window. Undefined means the stored span, floored like 48 h. */
  rangeHours?: number;
  /** Reference time for the raw-vs-hourly resolution boundary. */
  now?: number;
}

/**
 * Expected spacing of stored observations.
 * Newest 48 h stay at the 15-minute collection cadence; older samples are hourly.
 */
export function expectedIntervalMs(
  rangeHours: number | undefined,
  now?: number,
  observedAt?: number,
): number {
  if (
    now !== undefined &&
    observedAt !== undefined &&
    now - observedAt > RAW_RETENTION_MS
  ) {
    return HOURLY_INTERVAL_MS;
  }
  if (rangeHours !== undefined && rangeHours > 48) {
    return HOURLY_INTERVAL_MS;
  }
  return COLLECTION_INTERVAL_MS;
}

/**
 * Floor below which a hole is never a meaningful gap.
 * 2 h on the 48 h window, 6 h on 7 d, 12 h on 30 d. An unbounded stored span
 * uses the 48 h floor.
 */
export function minimumGapMs(rangeHours: number | undefined): number {
  if (rangeHours === undefined || rangeHours <= 48) {
    return 2 * HOUR_MS;
  }
  if (rangeHours <= 7 * 24) {
    return 6 * HOUR_MS;
  }
  return 12 * HOUR_MS;
}

export function gapThresholdMs(
  rangeHours: number | undefined,
  expectedInterval: number = expectedIntervalMs(rangeHours),
): number {
  return Math.max(
    GAP_INTERVAL_MULTIPLIER * expectedInterval,
    minimumGapMs(rangeHours),
  );
}

export interface GapDetection {
  gaps: HistoryGap[];
  bridgedSamples: number;
  thresholdMs: number;
}

/**
 * A hole is a long gap only when it exceeds
 * `max(4 × expected interval, range floor)`. Shorter holes are bridged.
 * A reset or a plan-limit change does not hide a hole: the gap is shaded
 * across it, and the line still breaks there separately.
 * Points must be oldest → newest.
 */
export function detectGaps(
  points: readonly (Pick<QuotaHistoryPoint, "observedAt"> &
    Partial<Pick<QuotaHistoryPoint, "limit" | "cycle" | "usedRatio">>)[],
  thresholdMs: number,
  expectedIntervalMs: number,
): GapDetection {
  const gaps: HistoryGap[] = [];
  let bridgedSamples = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const delta = current.observedAt - previous.observedAt;
    if (delta > thresholdMs) {
      gaps.push({
        from: previous.observedAt,
        to: current.observedAt,
        labelHours: delta / HOUR_MS,
      });
      continue;
    }
    // A reset or a plan-limit change is its own break. The missed reads
    // around it belong to the shaded gap, not to the bridged count.
    if (cycleBoundaryChanged(current.cycle, previous.cycle, previous.usedRatio, current.usedRatio)) continue;
    if (limitChanged(previous.limit, current.limit)) continue;
    if (delta > expectedIntervalMs * BRIDGE_INTERVAL_FACTOR) {
      bridgedSamples += Math.max(0, Math.round(delta / expectedIntervalMs) - 1);
    }
  }

  return { gaps, bridgedSamples, thresholdMs };
}

export interface TrendFit {
  /** Ratio points per millisecond, time increasing toward now. */
  slope: number;
  /** Fitted ratio at `originMs`. */
  intercept: number;
  originMs: number;
}

/** Ordinary least-squares fit of usedRatio against time. */
export function fitTrend(
  points: readonly MetricHistoryPoint[],
): TrendFit | null {
  const count = points.length;
  if (count < 2) {
    return null;
  }

  const originMs = points[0]!.observedAt;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const point of points) {
    const x = point.observedAt - originMs;
    sumX += x;
    sumY += point.usedRatio;
    sumXX += x * x;
    sumXY += x * point.usedRatio;
  }

  const denominator = count * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  return { slope, intercept, originMs };
}

/** Clamped to the 0–100% quota range. */
export function predictTrend(fit: TrendFit, observedAt: number): number {
  const ratio = fit.intercept + fit.slope * (observedAt - fit.originMs);
  return Math.min(1, Math.max(0, ratio));
}

function limitChanged(
  previous: number | undefined,
  current: number | undefined,
): boolean {
  return previous !== undefined && current !== undefined && previous !== current;
}

/**
 * Breaks on a quota reset, a plan-limit change, or a hole longer than the
 * threshold. Shorter holes stay in the segment and are bridged.
 * Missing metric samples do not break the line.
 */
export function splitQuotaSegments(
  points: readonly QuotaHistoryPoint[],
  thresholdMs: number,
): { segments: QuotaHistorySegment[]; resets: number[]; limitChanges: number[] } {
  const segments: QuotaHistorySegment[] = [];
  const resets: number[] = [];
  const limitChanges: number[] = [];
  let current: QuotaHistorySegment | undefined;

  points.forEach((point, index) => {
    const previous = points[index - 1];
    let breakBefore: HistoryBreakKind | undefined;
    if (previous) {
      const midpoint = (previous.observedAt + point.observedAt) / 2;
      if (cycleBoundaryChanged(point.cycle, previous.cycle, previous.usedRatio, point.usedRatio)) {
        breakBefore = "reset";
        resets.push(midpoint);
      } else if (limitChanged(previous.limit, point.limit)) {
        breakBefore = "limit-change";
        limitChanges.push(midpoint);
      } else if (point.observedAt - previous.observedAt > thresholdMs) {
        breakBefore = "gap";
      }
    }

    if (!current || breakBefore) {
      current = { points: [], ...(breakBefore ? { breakBefore } : {}) };
      segments.push(current);
    }
    current.points.push(point);
  });

  return { segments, resets, limitChanges };
}

/** Fitted trend per continuous segment. Many short cycles keep only the newest. */
export function buildTrends(segments: readonly QuotaHistorySegment[]): TrendLine[] {
  const candidates =
    segments.length <= MANY_SEGMENTS ? segments : segments.slice(-1);
  return candidates.flatMap((segment) => {
    if (segment.points.length < 3) {
      return [];
    }
    const fit = fitTrend(segment.points);
    if (!fit) {
      return [];
    }
    const from = segment.points[0]!.observedAt;
    const to = segment.points.at(-1)!.observedAt;
    return [
      {
        from,
        to,
        fromRatio: predictTrend(fit, from),
        toRatio: predictTrend(fit, to),
      },
    ];
  });
}

function quotaPoints(
  history: readonly UsageHistoryObservation[],
  metricId: string,
): QuotaHistoryPoint[] {
  const points: QuotaHistoryPoint[] = [];
  for (const observation of [...history].sort(
    (left, right) => left.observedAt - right.observedAt,
  )) {
    const sample = observation.metrics.find(
      (candidate): candidate is Extract<MetricHistorySample, { type: "quota" }> =>
        candidate.type === "quota" && candidate.metricId === metricId,
    );
    if (!sample) {
      continue;
    }
    points.push({
      observedAt: observation.observedAt,
      usedRatio: sample.usedRatio,
      ...(sample.limit === undefined ? {} : { limit: sample.limit }),
      ...(sample.cycle === undefined ? {} : { cycle: sample.cycle }),
    });
  }
  return points;
}

export function quotaHistorySeries(
  history: readonly UsageHistoryObservation[],
  metricId: string,
  options: QuotaHistorySeriesOptions = {},
): QuotaHistorySeries {
  const points = quotaPoints(history, metricId);
  const threshold = gapThresholdMs(
    options.rangeHours,
    expectedIntervalMs(options.rangeHours),
  );
  const interval = expectedIntervalMs(options.rangeHours);
  // One pass over the raw timeline. A hole that contains a reset or a
  // plan-limit change is shaded once, and its missed reads are not also
  // counted as bridged.
  const { gaps, bridgedSamples } = detectGaps(points, threshold, interval);
  const { segments, resets, limitChanges } = splitQuotaSegments(points, threshold);

  return {
    segments,
    gaps,
    resets,
    limitChanges,
    trends: buildTrends(segments),
    bridgedSamples,
    gapThresholdMs: threshold,
  };
}

/** Forward jump this large, relative to the cycle length, is a real reset. */
const RESET_JUMP_FRACTION = 0.5;

/**
 * A cycle change is a quota reset only when `resetsAt` jumps forward by at
 * least half the cycle length, or the duration/cadence changes and usage
 * drops. Millisecond and second jitter, and slow rolling drift, are not resets.
 * `left` is the newer cycle.
 */
function cycleBoundaryChanged(
  left: MetricCycle | undefined,
  right: MetricCycle | undefined,
  previousUsedRatio?: number,
  currentUsedRatio?: number,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left.durationMs !== right.durationMs || left.cadence !== right.cadence) {
    const usageKnown = previousUsedRatio !== undefined && currentUsedRatio !== undefined;
    if (!usageKnown || currentUsedRatio < previousUsedRatio) return true;
  }
  if (left.resetsAt === undefined || right.resetsAt === undefined) {
    return false;
  }
  const duration = left.durationMs ?? right.durationMs;
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  return left.resetsAt - right.resetsAt >= duration * RESET_JUMP_FRACTION;
}
