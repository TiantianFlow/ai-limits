import type { DisplayMode, MetricCycle } from "./model";

export type PaceKind = "ahead" | "on-pace" | "behind";

export interface PaceStatus {
  kind: PaceKind;
  deltaPoints: number;
}

function isFiniteNumber(value: number | undefined): value is number {
  return Number.isFinite(value);
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return value === Infinity ? 1 : 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function displayRatio(usedRatio: number, mode: DisplayMode): number {
  const used = clampRatio(usedRatio);

  return mode === "used" ? used : 1 - used;
}

export function elapsedRatio(
  cycle: MetricCycle,
  now: number,
): number | undefined {
  if (!Number.isFinite(now) || !isFiniteNumber(cycle.resetsAt)) {
    return undefined;
  }

  // The window has already reset. Elapsed time of the closed window would
  // read as "7 / 7 days" while the quota itself is back to empty.
  if (cycle.resetsAt < now) return undefined;

  if (isFiniteNumber(cycle.startedAt) && cycle.resetsAt > cycle.startedAt) {
    return clampRatio((now - cycle.startedAt) / (cycle.resetsAt - cycle.startedAt));
  }

  if (isFiniteNumber(cycle.durationMs) && cycle.durationMs > 0) {
    return clampRatio(1 - (cycle.resetsAt - now) / cycle.durationMs);
  }

  return undefined;
}

/**
 * How every surface should read a quota once `resetsAt` is known relative to now.
 * A past reset is one story: 0% used, labelled as an estimate, waiting for a
 * new reading. Pace is not computed from that stale window.
 */
export interface ClosedWindowReading {
  /** True when the latest known reset is already in the past. */
  closed: boolean;
  /** 0 when closed, otherwise the stored used ratio. */
  usedRatio: number;
  /** The reset to name. A past reset is never presented as a future "Resets". */
  resetsAt: number | undefined;
  /** Fixed grids may name the next grid reset. First-use meters never roll forward. */
  nextResetAt: number | undefined;
}

export function closedWindowReading(input: {
  usedRatio: number;
  resetsAt: number | undefined;
  now: number;
  /** Fixed-grid meters may roll to the next reset. First-use meters must not. */
  policy?: "fixed" | "first-use";
  durationMs?: number;
}): ClosedWindowReading {
  const resetsAt = Number.isFinite(input.resetsAt) ? input.resetsAt : undefined;
  const closed = resetsAt !== undefined && resetsAt < input.now;
  let nextResetAt: number | undefined;
  if (
    closed
    && input.policy === "fixed"
    && isFiniteNumber(input.durationMs)
    && input.durationMs > 0
    && resetsAt !== undefined
  ) {
    const behind = input.now - resetsAt;
    const steps = Math.floor(behind / input.durationMs) + 1;
    const rolled = resetsAt + steps * input.durationMs;
    if (rolled > input.now) nextResetAt = rolled;
  }
  return {
    closed,
    usedRatio: closed ? 0 : input.usedRatio,
    resetsAt,
    nextResetAt,
  };
}

export function paceStatus(usedRatio: number, elapsed: number): PaceStatus {
  const deltaPoints = Math.round((clampRatio(usedRatio) - clampRatio(elapsed)) * 100);

  if (deltaPoints > 5) {
    return { kind: "ahead", deltaPoints };
  }

  if (deltaPoints < -5) {
    return { kind: "behind", deltaPoints };
  }

  return { kind: "on-pace", deltaPoints };
}
