import type { MetricCycle, UsageHistoryObservation } from "./model";
import type { ProviderKind } from "./provider-kind";

/**
 * Deterministic synthetic history shaped like a real 30-day export.
 * Every value is generated from a seed. Nothing here is a real reading.
 */

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1_000;

export const FIXTURE_NOW = Date.UTC(2026, 9, 8, 18, 0, 0);

export interface RealisticMeter {
  providerKind: ProviderKind;
  providerName: string;
  metricId: string;
  label: string;
  history: UsageHistoryObservation[];
  /** Latest reading of the window that contains FIXTURE_NOW, when one exists. */
  currentUsedRatio: number | undefined;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** ResetsAt jitter of a few milliseconds up to a couple of seconds, plus a slow drift. */
function jitter(random: () => number, at: number): number {
  const drift = Math.floor((at % (7 * DAY)) / DAY) * 40;
  const shake = Math.floor(random() * 2_400) - 800;
  return drift + shake;
}

function quota(
  metricId: string,
  observedAt: number,
  usedRatio: number,
  cycle: MetricCycle,
): UsageHistoryObservation {
  return {
    observedAt,
    metrics: [{
      type: "quota",
      metricId,
      usedRatio: Math.min(0.97, Math.max(0, Math.round(usedRatio * 1000) / 1000)),
      cycle,
    }],
  };
}

function pushReading(
  history: UsageHistoryObservation[],
  metricId: string,
  observedAt: number,
  windowStart: number,
  windowEnd: number,
  cycle: MetricCycle,
): void {
  const span = Math.max(1, windowEnd - windowStart);
  const progress = Math.min(1, Math.max(0, (observedAt - windowStart) / span));
  history.push(quota(metricId, observedAt, 0.04 + progress * 0.5, cycle));
}

/**
 * Weekly fixed grid. Readings every 15 min for the last 48 h, hourly before
 * that, one hole of `holeHours` ending `holeEndAgo` before now.
 */
function weeklyGrid(options: {
  metricId: string;
  windowMs: number;
  days: number;
  holeHours: number;
  holeEndAgoHours: number;
  seed: number;
  now: number;
}): UsageHistoryObservation[] {
  const random = mulberry32(options.seed);
  const history: UsageHistoryObservation[] = [];
  const anchor = options.now + 3 * DAY;
  const rangeStart = options.now - options.days * DAY;
  const holeEnd = options.now - options.holeEndAgoHours * HOUR;
  const holeStart = holeEnd - options.holeHours * HOUR;
  for (let end = anchor; end - options.windowMs > rangeStart - options.windowMs; end -= options.windowMs) {
    const drifted = end + jitter(random, end);
    const cycle: MetricCycle = {
      cadence: "calendar",
      durationMs: options.windowMs,
      resetsAt: drifted,
    };
    const start = end - options.windowMs;
    for (let at = Math.max(start, rangeStart); at < Math.min(end, options.now); ) {
      const raw = options.now - at <= 48 * HOUR;
      if (at < holeStart || at > holeEnd) {
        pushReading(history, options.metricId, at + Math.floor(random() * 20_000), start, end, cycle);
      }
      at += raw ? 15 * MINUTE : HOUR;
    }
  }
  return history.sort((left, right) => left.observedAt - right.observedAt);
}

/**
 * First-use 5-hour windows with a long idle stretch, then one window whose
 * only reading is well before its reset. At 48 h that tail is a circle and
 * the stretch to the next window is blank unless the chart covers it.
 * `short` adds a gap shorter than one window between two of those windows.
 */
export function firstUseIdleGap(options: {
  metricId: string;
  windowMs: number;
  now: number;
  short?: boolean;
}): UsageHistoryObservation[] {
  const history: UsageHistoryObservation[] = [];
  const push = (observedAt: number, usedRatio: number): void => {
    const windowStart = Math.floor(observedAt / HOUR) * HOUR;
    history.push(quota(options.metricId, observedAt, usedRatio, {
      cadence: "rolling",
      durationMs: options.windowMs,
      resetsAt: windowStart + options.windowMs,
    }));
  };
  // Two windows about a day ago, then nothing until one window near now
  // whose reading sits hours before the reset.
  push(options.now - 40 * HOUR, 0.2);
  if (options.short) push(options.now - 34 * HOUR, 0.1);
  push(options.now - 30 * HOUR, 0.15);
  push(options.now - 6 * HOUR, 0.08);
  return history;
}

/**
 * Fixed 5-hour grid that keeps reporting 0% while idle. Every resetsAt is
 * anchor + k·5h. Most readings are 0%, and long runs of windows have none.
 */
export function idleGrid(options: {
  metricId: string;
  windowMs: number;
  now: number;
  anchor: number;
}): UsageHistoryObservation[] {
  const history: UsageHistoryObservation[] = [];
  const push = (observedAt: number, usedRatio: number, resetsAt: number): void => {
    history.push(quota(options.metricId, observedAt, usedRatio, {
      cadence: "rolling",
      durationMs: options.windowMs,
      resetsAt,
    }));
  };
  const grid = (at: number): number => {
    const steps = Math.ceil((at - options.anchor) / options.windowMs);
    return options.anchor + steps * options.windowMs;
  };
  // A burst of use, then a long empty run, then zeros on the same grid.
  push(options.now - 40 * HOUR, 0.4, grid(options.now - 40 * HOUR));
  push(options.now - 39 * HOUR, 0.1, grid(options.now - 39 * HOUR));
  for (let ago = 20; ago >= 1; ago -= 5) {
    const at = options.now - ago * HOUR;
    push(at, 0, grid(at));
  }
  return history;
}

/** Sparse first-use windows: hour-quantized starts, reported even at 0% used. */
function sparseFirstUse(options: {
  metricId: string;
  count: number;
  spanDays: number;
  windowMs: number;
  seed: number;
  now: number;
}): UsageHistoryObservation[] {
  const random = mulberry32(options.seed);
  const history: UsageHistoryObservation[] = [];
  const start = options.now - options.spanDays * DAY;
  for (let index = 0; index < options.count; index += 1) {
    const slot = start + ((index + 0.5) / options.count) * options.spanDays * DAY;
    const observedAt = Math.floor(slot / HOUR) * HOUR + 11 * MINUTE + 7_000;
    const windowStart = Math.floor(observedAt / HOUR) * HOUR;
    const resetsAt = windowStart + options.windowMs + jitter(random, observedAt);
    const used = index % 9 === 0 ? 0 : 0.05 + (index % 5) * 0.04;
    history.push(quota(options.metricId, observedAt, used, {
      cadence: "rolling",
      durationMs: options.windowMs,
      resetsAt,
    }));
  }
  return history;
}

/** Calendar meter with no durationMs: high usage, one reset back to about 0. */
function calendarReset(options: {
  metricId: string;
  seed: number;
  now: number;
}): UsageHistoryObservation[] {
  const random = mulberry32(options.seed);
  const history: UsageHistoryObservation[] = [];
  const resetAt = options.now - 12 * DAY;
  for (let day = 27; day >= 0; day -= 1) {
    const at = options.now - day * DAY - 3 * HOUR;
    const before = at < resetAt;
    const anchor = before ? resetAt : resetAt + 30 * DAY;
    history.push(quota(options.metricId, at, before ? 0.9 + (27 - day) * 0.002 : 0.01 + (12 - day) * 0.004, {
      cadence: "calendar",
      resetsAt: anchor + jitter(random, at),
    }));
  }
  return history;
}

/**
 * First-use 30-day meter. While unused, resetsAt = observedAt + 30 d.
 * Once usage starts the reset is fixed.
 */
function rollingUntilUsed(options: {
  metricId: string;
  seed: number;
  now: number;
}): UsageHistoryObservation[] {
  const random = mulberry32(options.seed);
  const history: UsageHistoryObservation[] = [];
  const usageStarts = options.now - 9 * DAY;
  const fixedReset = usageStarts + 30 * DAY;
  for (let at = options.now - 27 * DAY; at <= options.now; at += 6 * HOUR) {
    const unused = at < usageStarts;
    const resetsAt = unused ? at + 30 * DAY : fixedReset + jitter(random, at);
    const progress = unused ? 0 : (at - usageStarts) / (30 * DAY);
    history.push(quota(options.metricId, at, unused ? 0 : 0.02 + progress * 0.4, {
      cadence: "rolling",
      durationMs: 30 * DAY,
      resetsAt,
    }));
  }
  return history;
}

/**
 * Weekly grid with a multi-day hole and readings that omit resetsAt,
 * the shape of a 2-hour meter stored beside the weekly pool.
 * `missingResetEvery` drops resetsAt on every Nth kept reading.
 */
export function weeklyWithHoleAndMissingResets(options: {
  metricId: string;
  windowMs: number;
  days: number;
  holeHours: number;
  holeEndAgoHours: number;
  missingResetEvery: number;
  seed: number;
  now: number;
}): UsageHistoryObservation[] {
  const history = weeklyGrid(options);
  return history.map((observation, index) => {
    if (options.missingResetEvery <= 0 || index % options.missingResetEvery !== 0) return observation;
    return {
      ...observation,
      metrics: observation.metrics.map((sample) => {
        if (sample.type !== "quota" || !sample.cycle) return sample;
        const { resetsAt: _dropped, ...cycle } = sample.cycle;
        return { ...sample, cycle };
      }),
    };
  });
}

/**
 * Monthly fixed meter whose window is 31 days, then 30, and whose used
 * ratio drops to 0 at that boundary. That is a reset, not a mid-window rise.
 */
export function monthlyDurationSwitch(options: {
  metricId: string;
  seed: number;
  now: number;
}): UsageHistoryObservation[] {
  const random = mulberry32(options.seed);
  const history: UsageHistoryObservation[] = [];
  const boundary = options.now - 10 * DAY;
  const previousEnd = boundary;
  const nextEnd = boundary + 30 * DAY;
  for (let at = options.now - 29 * DAY; at <= options.now; at += 12 * HOUR) {
    const before = at < boundary;
    const windowStart = before ? previousEnd - 31 * DAY : boundary;
    const windowEnd = before ? previousEnd : nextEnd;
    const progress = (at - windowStart) / (windowEnd - windowStart);
    history.push(quota(
      options.metricId,
      at,
      before ? 0.2 + progress * 0.5 : progress * 0.35,
      {
        cadence: "calendar",
        durationMs: before ? 31 * DAY : 30 * DAY,
        resetsAt: windowEnd + jitter(random, at),
      },
    ));
  }
  return history;
}

function currentUsed(history: UsageHistoryObservation[], metricId: string, now: number): number | undefined {
  const readings = history
    .map((observation) => ({
      observedAt: observation.observedAt,
      sample: observation.metrics.find(
        (sample) => sample.type === "quota" && sample.metricId === metricId,
      ),
    }))
    .filter((item) => item.sample && item.sample.type === "quota" && item.observedAt <= now);
  const latest = readings.at(-1);
  if (!latest?.sample || latest.sample.type !== "quota") return undefined;
  const resetsAt = latest.sample.cycle?.resetsAt;
  const duration = latest.sample.cycle?.durationMs;
  if (resetsAt === undefined || duration === undefined) return latest.sample.usedRatio;
  const start = resetsAt - duration;
  if (now < start || now > resetsAt + 5_000) return undefined;
  return latest.sample.usedRatio;
}

export function realisticMeters(now = FIXTURE_NOW): RealisticMeter[] {
  const claude = weeklyGrid({
    metricId: "weekly",
    windowMs: 7 * DAY,
    days: 30,
    holeHours: 18,
    holeEndAgoHours: 60,
    seed: 11,
    now,
  });
  const grok = weeklyWithHoleAndMissingResets({
    metricId: "weekly-pool",
    windowMs: 7 * DAY,
    days: 30,
    holeHours: 4 * 24,
    holeEndAgoHours: 5 * 24,
    missingResetEvery: 3,
    seed: 29,
    now,
  });
  const kimiWeek = weeklyGrid({
    metricId: "weekly-coding",
    windowMs: 7 * DAY,
    days: 30,
    holeHours: 0,
    holeEndAgoHours: 0,
    seed: 47,
    now,
  }).filter((_, index) => index % 7 === 0);
  const kimiShort = [
    ...sparseFirstUse({
      metricId: "five-hour-coding",
      count: 46,
      spanDays: 27,
      windowMs: 5 * HOUR,
      seed: 53,
      now,
    }),
    ...firstUseIdleGap({
      metricId: "five-hour-coding",
      windowMs: 5 * HOUR,
      now,
      short: true,
    }),
  ];
  const kimiMonth = calendarReset({ metricId: "monthly-total", seed: 71, now });
  const chatgpt = rollingUntilUsed({ metricId: "30-day", seed: 83, now });
  const cursorMonth = monthlyDurationSwitch({ metricId: "other-models-monthly", seed: 97, now });
  return [
    {
      providerKind: "claude",
      providerName: "Sample Weekly",
      metricId: "weekly",
      label: "Weekly messages",
      history: claude,
      currentUsedRatio: currentUsed(claude, "weekly", now),
    },
    {
      providerKind: "grok",
      providerName: "Sample Pool",
      metricId: "weekly-pool",
      label: "Weekly pool",
      history: grok,
      currentUsedRatio: currentUsed(grok, "weekly-pool", now),
    },
    {
      providerKind: "kimi",
      providerName: "Sample Sparse",
      metricId: "five-hour-coding",
      label: "5-hour usage",
      history: [...kimiShort, ...kimiWeek, ...kimiMonth],
      currentUsedRatio: currentUsed(kimiShort, "five-hour-coding", now),
    },
    {
      providerKind: "chatgpt",
      providerName: "Sample Rolling",
      metricId: "30-day",
      label: "30-day messages",
      history: chatgpt,
      currentUsedRatio: currentUsed(chatgpt, "30-day", now),
    },
    {
      providerKind: "cursor",
      providerName: "Sample Empty",
      metricId: "cursor-models-monthly",
      label: "Monthly models",
      history: [],
      currentUsedRatio: undefined,
    },
    {
      providerKind: "cursor",
      providerName: "Sample Cursor",
      metricId: "other-models-monthly",
      label: "Other models",
      history: cursorMonth,
      currentUsedRatio: currentUsed(cursorMonth, "other-models-monthly", now),
    },
  ];
}

export const REALISTIC_METERS = realisticMeters();
