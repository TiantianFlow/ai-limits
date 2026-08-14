import { describe, expect, test } from "vitest";

import { createProviderOperationLane } from "./provider-operation-lane";

const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";

describe("provider instance operation lane", () => {
  test("a connect supersedes refresh only for the same instance", () => {
    const lane = createProviderOperationLane();
    const refresh = lane.beginRefresh(FIRST)!;
    const siblingRefresh = lane.beginRefresh(SECOND)!;
    const connect = lane.beginConnect(FIRST)!;

    expect(lane.isCurrent(refresh)).toBe(false);
    expect(lane.isCurrent(connect)).toBe(true);
    expect(lane.isCurrent(siblingRefresh)).toBe(true);
    expect(lane.beginRefresh(FIRST)).toBeUndefined();
    expect(lane.beginRefresh(SECOND)).toBeDefined();
  });

  test("a newer refresh supersedes an older refresh for one instance", () => {
    const lane = createProviderOperationLane();
    const older = lane.beginRefresh(FIRST)!;
    const newer = lane.beginRefresh(FIRST)!;

    expect(lane.isCurrent(older)).toBe(false);
    expect(lane.isCurrent(newer)).toBe(true);
  });

  test("nested cleanup blocks only the target instance until all cleanup completes", () => {
    const lane = createProviderOperationLane();
    const refresh = lane.beginRefresh(FIRST)!;
    const siblingRefresh = lane.beginRefresh(SECOND)!;
    const firstCleanup = lane.beginCleanup(FIRST);
    const secondCleanup = lane.beginCleanup(FIRST);

    expect(lane.isCurrent(refresh)).toBe(false);
    expect(lane.isCurrent(siblingRefresh)).toBe(true);
    expect(lane.isCleaning(FIRST)).toBe(true);
    expect(lane.isCleaning(SECOND)).toBe(false);
    expect(lane.beginConnect(FIRST)).toBeUndefined();
    expect(lane.beginConnect(SECOND)).toBeDefined();

    lane.endCleanup(firstCleanup);
    expect(lane.beginConnect(FIRST)).toBeUndefined();
    lane.endCleanup(secondCleanup);
    expect(lane.beginConnect(FIRST)).toBeDefined();
  });
});
