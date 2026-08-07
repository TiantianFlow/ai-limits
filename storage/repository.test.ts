import { beforeEach, describe, expect, test } from "vitest";

import { createFixtureState } from "../providers/fixtures";
import {
  ensureState,
  loadState,
  setDisplayMode,
  updateProvider,
} from "./repository";

const now = 1_700_000_000_000;
const hour = 60 * 60 * 1_000;
const day = 24 * hour;

describe("fixture state", () => {
  test("creates all providers in cockpit order", () => {
    expect(createFixtureState(now).providers.map(({ providerId }) => providerId)).toEqual([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
      "antigravity",
    ]);
  });

  test("marks every snapshot as a fixture in demo mode", () => {
    const state = createFixtureState(now);

    expect(state.demoMode).toBe(true);
    expect(
      state.providers.flatMap(({ snapshot }) => (snapshot ? [snapshot.source] : [])),
    ).toEqual(["fixture", "fixture", "fixture", "fixture"]);
  });

  test("uses a five-days-elapsed ChatGPT weekly window", () => {
    const chatgpt = createFixtureState(now).providers.find(
      ({ providerId }) => providerId === "chatgpt",
    )?.snapshot;
    expect(chatgpt).toBeDefined();
    if (!chatgpt) {
      throw new Error("ChatGPT fixture is required for this test.");
    }
    const weekly = chatgpt.windows.find(({ id }) => id === "weekly")!;

    expect(weekly.startedAt).toBe(now - 5 * day);
    expect(weekly.resetsAt).toBe(now + 2 * day);
    expect(weekly.durationMs).toBe(7 * day);
    expect(chatgpt.windows.find(({ id }) => id === "five-hour")?.durationMs).toBe(5 * hour);
  });
});

describe("state repository", () => {
  beforeEach(async () => {
    await browser.storage.local.clear();
  });

  test("initializes once and persists the chosen display mode", async () => {
    await ensureState(now);
    expect((await loadState())?.preferences.displayMode).toBe("used");

    await setDisplayMode("left");
    expect((await loadState())?.preferences.displayMode).toBe("left");
  });

  test("updates only the requested provider record", async () => {
    await ensureState(now);
    const before = await loadState();

    await updateProvider("chatgpt", (provider) => ({
      ...provider,
      health: { kind: "temporary_error", message: "Retry later" },
    }));

    const after = await loadState();
    const updatedChatgpt = after?.providers.find(
      ({ providerId }) => providerId === "chatgpt",
    );
    expect(updatedChatgpt?.health).toEqual({
      kind: "temporary_error",
      message: "Retry later",
    });
    expect(after?.providers.slice(1)).toEqual(before?.providers.slice(1));
  });
});
