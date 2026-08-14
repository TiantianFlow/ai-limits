import { describe, expect, test, vi } from "vitest";

import { refreshGrantedInstances } from "./refresh";

const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";

describe("refreshing granted instances", () => {
  test("preserves durable enumeration order when sibling work settles out of order", async () => {
    let finishFirst: (() => void) | undefined;
    const collect = vi.fn(async (instanceId: string) => {
      if (instanceId === FIRST) {
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      }
      return { kind: "failure", category: "signed_out" } as const;
    });
    const pending = refreshGrantedInstances(
      [FIRST, SECOND],
      async () => true,
      collect,
      "manual_all",
      () => 10,
    );
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    finishFirst?.();

    const report = await pending;
    expect(report.results.map(({ instanceId }) => instanceId)).toEqual([
      FIRST,
      SECOND,
    ]);
  });

  test("skips only the sibling without permission", async () => {
    const collect = vi.fn(async () => ({ kind: "failure", category: "signed_out" } as const));

    const report = await refreshGrantedInstances(
      [FIRST, SECOND],
      async (instanceId) => instanceId === SECOND,
      collect,
      "manual_all",
      () => 10,
    );

    expect(report.results).toEqual([
      {
        instanceId: FIRST,
        outcome: { kind: "skipped", reason: "permission_required" },
      },
      {
        instanceId: SECOND,
        outcome: { kind: "failure", category: "signed_out" },
      },
    ]);
    expect(collect).toHaveBeenCalledWith(SECOND);
    expect(collect).not.toHaveBeenCalledWith(FIRST);
  });

  test("contains one instance failure without dropping later ordered results", async () => {
    const report = await refreshGrantedInstances(
      [FIRST, SECOND],
      async () => true,
      async (instanceId) => {
        if (instanceId === FIRST) throw new Error("provider raw failure");
        return { kind: "deferred", reason: "session_required" } as const;
      },
      "scheduled",
      () => 10,
    );

    expect(report.results).toEqual([
      {
        instanceId: FIRST,
        outcome: { kind: "failure", category: "temporary_error" },
      },
      {
        instanceId: SECOND,
        outcome: { kind: "deferred", reason: "session_required" },
      },
    ]);
  });
});
