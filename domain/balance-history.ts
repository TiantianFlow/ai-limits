import type { MetricHistorySample, UsageHistoryObservation } from "./model";

const HOUR_MS = 60 * 60 * 1_000;
/**
 * Readings are about 15 minutes apart, and hourly past 48 h. A longer silence
 * breaks the line rather than drawing a slope nobody observed.
 */
export const BALANCE_GAP_MS = 3 * HOUR_MS;
/** A rise this large is a top-up, not rounding or a small refund. */
const TOP_UP_MIN_RATIO = 0.01;
const TOP_UP_MIN_ABSOLUTE = 0.5;

export interface BalanceHistoryPoint {
  observedAt: number;
  value: number;
  /** Rise since the previous reading when it reads as a top-up. */
  topUp?: number;
}

export interface BalanceHistorySeries {
  unit: string | undefined;
  points: BalanceHistoryPoint[];
  /** Points split wherever readings stop for longer than BALANCE_GAP_MS. */
  runs: BalanceHistoryPoint[][];
  gaps: { start: number; end: number }[];
  /** Newest value minus the first value in range. Absent below two readings. */
  change?: number;
  topUps: number;
}

type BalanceSample = Extract<MetricHistorySample, { type: "balance" }>;

function isTopUp(previous: number, next: number): boolean {
  const rise = next - previous;
  return rise >= TOP_UP_MIN_ABSOLUTE && rise >= Math.abs(previous) * TOP_UP_MIN_RATIO;
}

/**
 * Balance readings for one meter between rangeStart and rangeEnd. Only the
 * newest reading's unit is kept, so a currency switch never mixes scales.
 */
export function balanceHistorySeries(
  history: readonly UsageHistoryObservation[],
  metricId: string,
  rangeStart: number,
  rangeEnd: number,
): BalanceHistorySeries {
  const readings = [...history]
    .sort((left, right) => left.observedAt - right.observedAt)
    .flatMap((observation) => {
      const sample = observation.metrics.find(
        (candidate): candidate is BalanceSample =>
          candidate.type === "balance" && candidate.metricId === metricId,
      );
      return sample && Number.isFinite(sample.value)
        ? [{ observedAt: observation.observedAt, sample }]
        : [];
    })
    .filter(({ observedAt }) => observedAt >= rangeStart && observedAt <= rangeEnd);
  const unit = readings.at(-1)?.sample.unit;
  const points: BalanceHistoryPoint[] = [];
  const runs: BalanceHistoryPoint[][] = [];
  const gaps: { start: number; end: number }[] = [];
  let topUps = 0;

  for (const { observedAt, sample } of readings) {
    if (sample.unit !== unit) continue;
    const previous = points.at(-1);
    const point: BalanceHistoryPoint = { observedAt, value: sample.value };
    if (previous && isTopUp(previous.value, sample.value)) {
      point.topUp = sample.value - previous.value;
      topUps += 1;
    }
    if (!previous || observedAt - previous.observedAt > BALANCE_GAP_MS) {
      if (previous) gaps.push({ start: previous.observedAt, end: observedAt });
      runs.push([]);
    }
    runs.at(-1)!.push(point);
    points.push(point);
  }

  const first = points[0];
  const last = points.at(-1);
  return {
    unit,
    points,
    runs,
    gaps,
    ...(first && last && points.length > 1 ? { change: last.value - first.value } : {}),
    topUps,
  };
}

/** A round top for a zero-based axis: 1, 2, 2.5 or 5 times a power of ten. */
export function balanceAxisMax(values: readonly number[]): number {
  const peak = Math.max(0, ...values);
  if (!(peak > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= peak) return step * power;
  }
  return 10 * power;
}
