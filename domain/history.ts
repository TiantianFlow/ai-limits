import type {
  MetricCycle,
  MetricHistorySample,
  ProviderSnapshot,
  QuotaHistoryObservation,
  QuotaHistorySample,
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";

const HOUR_MS = 60 * 60 * 1_000;
const RAW_RETENTION_MS = 48 * HOUR_MS;
const MAX_RETENTION_MS = 30 * 24 * HOUR_MS;
const MAX_OBSERVATIONS = 1_024;
const MAX_SEGMENT_GAP_MS = 90 * 60 * 1_000;

export interface QuotaHistoryPoint {
  observedAt: number;
  usedRatio: number;
}

export function observationFromUsage(
  snapshot: UsageSnapshot,
): UsageHistoryObservation {
  return {
    observedAt: snapshot.fetchedAt,
    metrics: snapshot.metrics.map((metric): MetricHistorySample => {
      switch (metric.type) {
        case "quota":
          return {
            metricId: metric.id,
            type: metric.type,
            usedRatio: metric.usedRatio,
            ...(metric.cycle === undefined ? {} : { cycle: metric.cycle }),
          };
        case "counter":
          return {
            metricId: metric.id,
            type: metric.type,
            semantic: metric.semantic,
            value: metric.value,
            unit: metric.unit,
            ...(metric.limit === undefined ? {} : { limit: metric.limit }),
            ...(metric.cycle === undefined ? {} : { cycle: metric.cycle }),
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
            ...(metric.cycle === undefined ? {} : { cycle: metric.cycle }),
          };
      }
    }),
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

export function observationFromSnapshot(
  snapshot: ProviderSnapshot,
): QuotaHistoryObservation {
  return {
    observedAt: snapshot.fetchedAt,
    windows: snapshot.windows.map(
      ({ id, usedRatio, startedAt, resetsAt, durationMs }): QuotaHistorySample => ({
        windowId: id,
        usedRatio,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(resetsAt === undefined ? {} : { resetsAt }),
        ...(durationMs === undefined ? {} : { durationMs }),
      }),
    ),
  };
}

export function appendQuotaObservation(
  history: readonly QuotaHistoryObservation[],
  snapshot: ProviderSnapshot,
): QuotaHistoryObservation[] {
  return retainQuotaHistory(
    [...history, observationFromSnapshot(snapshot)],
    snapshot.fetchedAt,
  );
}

export function retainQuotaHistory(
  history: readonly QuotaHistoryObservation[],
  referenceAt: number,
): QuotaHistoryObservation[] {
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
): QuotaHistoryPoint[][];
export function quotaHistorySegments(
  history: readonly QuotaHistoryObservation[],
  windowId: string,
): QuotaHistoryPoint[][];
export function quotaHistorySegments(
  history: readonly (UsageHistoryObservation | QuotaHistoryObservation)[],
  metricId: string,
): QuotaHistoryPoint[][] {
  const firstObservation = history[0];
  if (firstObservation !== undefined && "windows" in firstObservation) {
    return legacyQuotaHistorySegments(
      history as readonly QuotaHistoryObservation[],
      metricId,
    );
  }

  return metricQuotaHistorySegments(
    history as readonly UsageHistoryObservation[],
    metricId,
  );
}

function metricQuotaHistorySegments(
  history: readonly UsageHistoryObservation[],
  metricId: string,
): QuotaHistoryPoint[][] {
  const segments: QuotaHistoryPoint[][] = [];
  let segment: QuotaHistoryPoint[] = [];
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

function legacyQuotaHistorySegments(
  history: readonly QuotaHistoryObservation[],
  windowId: string,
): QuotaHistoryPoint[][] {
  const segments: QuotaHistoryPoint[][] = [];
  let segment: QuotaHistoryPoint[] = [];
  let previousObservation: QuotaHistoryObservation | undefined;
  let previousSample: QuotaHistorySample | undefined;

  for (const observation of [...history].sort(
    (left, right) => left.observedAt - right.observedAt,
  )) {
    const sample = observation.windows.find(
      (candidate) => candidate.windowId === windowId,
    );
    if (!sample) {
      if (segment.length > 0) {
        segments.push(segment);
        segment = [];
      }
      previousObservation = undefined;
      previousSample = undefined;
      continue;
    }

    if (
      previousObservation &&
      previousSample &&
      (observation.observedAt - previousObservation.observedAt >
        MAX_SEGMENT_GAP_MS ||
        sample.resetsAt !== previousSample.resetsAt)
    ) {
      segments.push(segment);
      segment = [];
    }

    segment.push({
      observedAt: observation.observedAt,
      usedRatio: sample.usedRatio,
    });
    previousObservation = observation;
    previousSample = sample;
  }

  if (segment.length > 0) {
    segments.push(segment);
  }

  return segments;
}
