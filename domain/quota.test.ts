import { describe, expect, test } from "vitest";

import {
  clampRatio,
  displayRatio,
  elapsedRatio,
  paceStatus,
} from "./quota";

describe("quota semantics", () => {
  const now = 1_700_000_000_000;
  const hour = 60 * 60 * 1_000;
  const day = 24 * hour;

  test("displays canonical usage in Used mode", () => {
    expect(displayRatio(0.72, "used")).toBe(0.72);
  });

  test("displays remaining capacity in Left mode", () => {
    expect(displayRatio(0.72, "left")).toBeCloseTo(0.28);
  });

  test("calculates elapsed progress from an exact start and reset", () => {
    expect(
      elapsedRatio({ startedAt: now - 5 * day, resetsAt: now + 2 * day }, now),
    ).toBeCloseTo(5 / 7);
  });

  test("calculates elapsed progress from a duration and reset", () => {
    expect(
      elapsedRatio({ durationMs: 5 * hour, resetsAt: now + 2 * hour }, now),
    ).toBeCloseTo(3 / 5);
  });

  test("does not infer elapsed progress without a known window length", () => {
    expect(elapsedRatio({ resetsAt: now + day }, now)).toBeUndefined();
  });

  test("does not infer elapsed progress from a cycle without a reset", () => {
    expect(elapsedRatio({ startedAt: now - day, durationMs: day }, now)).toBeUndefined();
  });

  test("identifies consumption materially ahead of elapsed time", () => {
    expect(paceStatus(0.72, 0.6)).toEqual({ kind: "ahead", deltaPoints: 12 });
  });

  test("keeps small pace differences on pace", () => {
    expect(paceStatus(0.67, 0.71)).toEqual({
      kind: "on-pace",
      deltaPoints: -4,
    });
  });

  test("clamps ratios above one", () => {
    expect(clampRatio(1.4)).toBe(1);
  });

  test("clamps ratios below zero", () => {
    expect(clampRatio(-0.2)).toBe(0);
  });

  test("keeps an exact five-point pace difference on pace", () => {
    expect(paceStatus(0.65, 0.6)).toEqual({
      kind: "on-pace",
      deltaPoints: 5,
    });
  });
});
