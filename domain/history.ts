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
const MAX_SEGMENT_GAP_MS = 90 * 60 * 1_000;

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
): MetricHistoryPoint[][] {
  const segments: MetricHistoryPoint[][] = [];
  let segment: MetricHistoryPoint[] = [];
  let previousObservedAt: number | undefined;
  let previousSample: Extract<MetricHistorySample, { type: "quota" }> | undefined;

  for (const observation of [...history].sort(
    (left, right) => left.observedAt - right.observedAt,
  )) {
    const sample = observation.metrics.find(
      (candidate): candidate is Extract<MetricHistorySample, { type: "quota" }> =>
        candidate.type === "quota" && candidate.metricId === metricId,
    );
    if (!sample) {
      if (segment.length > 0) {
        segments.push(segment);
        segment = [];
      }
      previousObservedAt = undefined;
      previousSample = undefined;
      continue;
    }

    if (
      previousObservedAt !== undefined &&
      previousSample &&
      (observation.observedAt - previousObservedAt > MAX_SEGMENT_GAP_MS ||
        cycleBoundaryChanged(sample.cycle, previousSample.cycle))
    ) {
      segments.push(segment);
      segment = [];
    }

    segment.push({
      observedAt: observation.observedAt,
      usedRatio: sample.usedRatio,
    });
    previousObservedAt = observation.observedAt;
    previousSample = sample;
  }

  if (segment.length > 0) {
    segments.push(segment);
  }

  return segments;
}

function cycleBoundaryChanged(
  left: MetricCycle | undefined,
  right: MetricCycle | undefined,
): boolean {
  return (
    left?.resetsAt !== right?.resetsAt ||
    left?.startedAt !== right?.startedAt ||
    left?.durationMs !== right?.durationMs ||
    left?.cadence !== right?.cadence
  );
}
