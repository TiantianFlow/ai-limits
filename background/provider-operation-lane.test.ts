import { describe, expect, test } from "vitest";

import { createProviderOperationLane } from "./provider-operation-lane";

describe("provider operation lane", () => {
  test("connect supersedes refresh and blocks refresh until it finishes", () => {
    const lane = createProviderOperationLane();
    const refresh = lane.beginRefresh("elevenlabs")!;
    const connect = lane.beginConnect("elevenlabs")!;

    expect(lane.isCurrent(refresh)).toBe(false);
    expect(lane.isCurrent(connect)).toBe(true);
    expect(lane.beginRefresh("elevenlabs")).toBeUndefined();

    lane.finish(refresh);
    expect(lane.beginRefresh("elevenlabs")).toBeUndefined();
    lane.finish(connect);
    expect(lane.beginRefresh("elevenlabs")).toBeDefined();
  });

  test("a newer refresh supersedes an older refresh", () => {
    const lane = createProviderOperationLane();
    const older = lane.beginRefresh("chatgpt")!;
    const newer = lane.beginRefresh("chatgpt")!;

    expect(lane.isCurrent(older)).toBe(false);
    expect(lane.isCurrent(newer)).toBe(true);
  });

  test("nested cleanup blocks every operation until all cleanup completes", () => {
    const lane = createProviderOperationLane();
    const refresh = lane.beginRefresh("elevenlabs")!;
    const firstCleanup = lane.beginCleanup("elevenlabs");
    const secondCleanup = lane.beginCleanup("elevenlabs");

    expect(lane.isCurrent(refresh)).toBe(false);
    expect(lane.isCleaning("elevenlabs")).toBe(true);
    expect(lane.beginRefresh("elevenlabs")).toBeUndefined();
    expect(lane.beginConnect("elevenlabs")).toBeUndefined();

    lane.endCleanup(firstCleanup);
    expect(lane.beginConnect("elevenlabs")).toBeUndefined();
    lane.endCleanup(secondCleanup);
    expect(lane.beginConnect("elevenlabs")).toBeDefined();
  });
});
