import type { DisplayMode, QuotaWindow } from "./model";

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
  window: Pick<QuotaWindow, "startedAt" | "resetsAt" | "durationMs">,
  now: number,
): number | undefined {
  if (!Number.isFinite(now) || !isFiniteNumber(window.resetsAt)) {
    return undefined;
  }

  if (isFiniteNumber(window.startedAt) && window.resetsAt > window.startedAt) {
    return clampRatio((now - window.startedAt) / (window.resetsAt - window.startedAt));
  }

  if (isFiniteNumber(window.durationMs) && window.durationMs > 0) {
    return clampRatio(1 - (window.resetsAt - now) / window.durationMs);
  }

  return undefined;
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
