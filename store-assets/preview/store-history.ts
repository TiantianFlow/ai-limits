import { observationFromUsage } from "../../domain/history";
import type { QuotaMetric, UsageSnapshot } from "../../domain/model";
import type { AppViewState } from "../../domain/public-protocol";

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Days of synthetic History behind each store-artwork provider. */
export const STORE_HISTORY_DAYS = 14;
/** Fixture clock zone offset (America/Toronto in August, UTC-4). */
const FIXTURE_ZONE_OFFSET = -4 * HOUR;

/** Deterministic 0–1 noise, so every capture draws the same chart. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return x - Math.floor(x);
}

function seedOf(text: string): number {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) % 9_973;
  return hash;
}

/** Reading times: every 15 minutes for 48 hours, hourly before that. */
export function storeHistoryTimes(now: number): number[] {
  const times: number[] = [];
  for (let at = now - STORE_HISTORY_DAYS * DAY; at < now; ) {
    times.push(at);
    at += now - at <= 48 * HOUR ? 15 * MINUTE : HOUR;
  }
  return times;
}

interface WindowPlan {
  start: number;
  reset: number;
  /** Used ratio the window reaches at its last reading. */
  end: number;
}

function windowFor(metric: QuotaMetric, at: number, now: number): WindowPlan | undefined {
  const cycle = metric.cycle;
  if (!cycle?.resetsAt || !cycle.durationMs) return undefined;
  const duration = cycle.durationMs;
  const back = Math.floor((cycle.resetsAt - at) / duration);
  const reset = cycle.resetsAt - back * duration;
  const start = reset - duration;
  if (back === 0) return { start, reset, end: metric.usedRatio };

  const seed = seedOf(metric.id) + back * 7;
  const localStartHour = new Date(start + FIXTURE_ZONE_OFFSET).getUTCHours();
  const overnight = duration <= 6 * HOUR && localStartHour >= 0 && localStartHour < 7;
  const end = overnight
    ? 0.04 * noise(seed)
    : Math.min(0.97, 0.38 + 0.55 * noise(seed));
  return { start, reset, end: start + duration > now ? metric.usedRatio : end };
}

/**
 * Used ratio at `at`: a bursty, never-decreasing climb from 0 at the window
 * start to the window's final value, which resets to 0 at the next window.
 */
function usedAt(metric: QuotaMetric, plan: WindowPlan, at: number, times: readonly number[], now: number): number {
  const last = Math.min(plan.reset, now);
  const inWindow = times.filter((time) => time >= plan.start && time <= last);
  const weights = inWindow.map((time) => noise(seedOf(metric.id) + time / MINUTE) ** 3);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let climbed = 0;
  for (const [index, time] of inWindow.entries()) {
    if (time > at) break;
    climbed += weights[index] ?? 0;
  }
  return Math.round(plan.end * (climbed / total) * 1_000) / 1_000;
}

function snapshotAt(snapshot: UsageSnapshot, at: number, times: readonly number[], now: number): UsageSnapshot {
  return {
    ...snapshot,
    fetchedAt: at,
    metrics: snapshot.metrics.map((metric) => {
      if (metric.type !== "quota") return metric;
      const plan = windowFor(metric, at, now);
      if (!plan || !metric.cycle) return metric;
      const usedRatio = usedAt(metric, plan, at, [...times, now], now);
      return {
        ...metric,
        usedRatio,
        ...(metric.used !== undefined && metric.limit !== undefined
          ? { used: Math.round(metric.limit * usedRatio) }
          : {}),
        cycle: {
          ...metric.cycle,
          ...(metric.cycle.startedAt === undefined ? {} : { startedAt: plan.start }),
          resetsAt: plan.reset,
        },
      };
    }),
  };
}

/**
 * Replace each fixture instance's three-reading History with two weeks of
 * synthetic readings, so the store History artwork shows real climbs and
 * resets. Representative data only: nothing comes from a real account.
 */
export function withStoreHistory(state: AppViewState, now: number): AppViewState {
  const times = storeHistoryTimes(now);
  return {
    ...state,
    instances: state.instances.map((instance) => {
      const snapshot = instance.snapshot;
      if (!snapshot) return instance;
      return {
        ...instance,
        history: [
          ...times.map((at) => observationFromUsage(snapshotAt(snapshot, at, times, now))),
          observationFromUsage(snapshot),
        ],
      };
    }),
  };
}
