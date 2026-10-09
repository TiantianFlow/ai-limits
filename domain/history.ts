import type {
  MetricCycle,
  MetricHistorySample,
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";
import { boundaryKeepers, cycleBoundaryChanged } from "./history-envelope";

const HOUR_MS = 60 * 60 * 1_000;
const RAW_RETENTION_MS = 48 * HOUR_MS;
const MAX_RETENTION_MS = 30 * 24 * HOUR_MS;
const MAX_OBSERVATIONS = 1_024;
/**
 * Scheduled refresh is about every 15 minutes
 * (`REFRESH_PERIOD_MINUTES` in the background entry). Older than 48 h is
 * compacted to one sample per hour.
 */
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

function retainHistory(
  history: readonly UsageHistoryObservation[],
  referenceAt: number,
): UsageHistoryObservation[] {
  const byTimestamp = new Map<number, UsageHistoryObservation>();
  for (const observation of history) {
    byTimestamp.set(observation.observedAt, observation);
  }

  const cutoff = referenceAt - MAX_RETENTION_MS;
  const rawCutoff = referenceAt - RAW_RETENTION_MS;
  const ordered = [...byTimestamp.values()]
    .filter(({ observedAt }) => observedAt >= cutoff)
    .sort((left, right) => left.observedAt - right.observedAt);
  // The hourly bucket keeps the last observation. Also keep, per meter, the
  // last observation before each window boundary so a reset inside the hour
  // does not drop the old window's final reading.
  const preserved = boundaryKeepers(ordered);
  const hourly = new Map<number, UsageHistoryObservation>();
  const boundary: UsageHistoryObservation[] = [];
  const raw: UsageHistoryObservation[] = [];

  for (const observation of ordered) {
    if (observation.observedAt >= rawCutoff) {
      raw.push(observation);
      continue;
    }
    hourly.set(Math.floor(observation.observedAt / HOUR_MS), observation);
    if (preserved.has(observation.observedAt)) boundary.push(observation);
  }

  const compacted = new Map<number, UsageHistoryObservation>();
  for (const observation of [...hourly.values(), ...boundary]) {
    compacted.set(observation.observedAt, observation);
  }

  return [...compacted.values()]
    .sort((left, right) => left.observedAt - right.observedAt)
    .concat(raw)
    .slice(-MAX_OBSERVATIONS);
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

export type HistoryBreakKind = "reset" | "limit-change";

export interface QuotaHistorySegment {
  points: QuotaHistoryPoint[];
  /** Why the series is broken before this segment starts. */
  breakBefore?: HistoryBreakKind;
}

export interface QuotaHistorySeries {
  /** One segment per quota window. A plan-limit change also starts a segment. */
  segments: QuotaHistorySegment[];
  resets: number[];
  limitChanges: number[];
}

export interface QuotaHistorySeriesOptions {
  rangeHours?: number;
  now?: number;
  providerKind?: import("./provider-kind").ProviderKind;
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
    if (!sample) continue;
    points.push({
      observedAt: observation.observedAt,
      usedRatio: sample.usedRatio,
      ...(sample.limit === undefined ? {} : { limit: sample.limit }),
      ...(sample.cycle === undefined ? {} : { cycle: sample.cycle }),
    });
  }
  return points;
}

/**
 * Groups readings into one segment per quota window. A window boundary is a
 * reset under `cycleBoundaryChanged`. A plan-limit change inside a window
 * starts a new segment but is not a reset.
 */
export function quotaHistorySeries(
  history: readonly UsageHistoryObservation[],
  metricId: string,
  _options: QuotaHistorySeriesOptions = {},
): QuotaHistorySeries {
  const points = quotaPoints(history, metricId);
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
      } else if (
        previous.limit !== undefined &&
        point.limit !== undefined &&
        previous.limit !== point.limit
      ) {
        breakBefore = "limit-change";
        limitChanges.push(midpoint);
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

export { cycleBoundaryChanged };
