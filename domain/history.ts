import type {
  ProviderSnapshot,
  QuotaHistoryObservation,
  QuotaHistorySample,
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
  const byTimestamp = new Map<number, QuotaHistoryObservation>();
  for (const observation of history) {
    byTimestamp.set(observation.observedAt, observation);
  }

  const cutoff = referenceAt - MAX_RETENTION_MS;
  const rawCutoff = referenceAt - RAW_RETENTION_MS;
  const ordered = [...byTimestamp.values()]
    .filter(({ observedAt }) => observedAt >= cutoff)
    .sort((left, right) => left.observedAt - right.observedAt);
  const compacted = new Map<number, QuotaHistoryObservation>();
  const raw: QuotaHistoryObservation[] = [];

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
