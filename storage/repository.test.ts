import { beforeEach, describe, expect, test } from "vitest";

import { createFixtureState } from "../providers/fixtures";
import { createInitialState } from "../providers/initial-state";
import {
  ensureState,
  loadState,
  saveState,
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
    ]);
  });

  test("marks every fixture snapshot as a fixture", () => {
    const state = createFixtureState(now);

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

  test("uses exact UTC calendar-month boundaries for Cursor", () => {
    const cursor = createFixtureState(now).providers.find(
      ({ providerId }) => providerId === "cursor",
    )?.snapshot;
    const monthly = cursor?.windows.find(({ id }) => id === "monthly");

    expect(monthly?.startedAt).toBe(Date.UTC(2023, 10, 1));
    expect(monthly?.resetsAt).toBe(Date.UTC(2023, 11, 1));
    expect(monthly?.durationMs).toBe(Date.UTC(2023, 11, 1) - Date.UTC(2023, 10, 1));
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

  test("creates the canonical snapshot-free provider states", () => {
    const state = createInitialState();

    expect(state.providers.map(({ health }) => health.kind)).toEqual([
      "permission_required",
      "permission_required",
      "permission_required",
      "permission_required",
    ]);
    expect(state.providers.every(({ snapshot }) => snapshot === undefined)).toBe(true);
  });

  test("migrates legacy fixture state without exposing fake usage", async () => {
    const legacyState = createFixtureState(now) as unknown as Record<string, unknown>;
    delete legacyState.version;
    legacyState.preferences = { displayMode: "left" };
    await browser.storage.local.set({ aiLimitsState: legacyState });

    const state = await ensureState(now);

    expect(state.preferences.displayMode).toBe("left");
    expect(state.providers.map(({ health }) => health.kind)).toEqual([
      "permission_required",
      "permission_required",
      "permission_required",
      "permission_required",
    ]);
    expect(state.providers.every(({ snapshot }) => snapshot === undefined)).toBe(true);
    expect(await loadState()).toEqual(state);
  });

  test("preserves a matching live snapshot during migration", async () => {
    const legacyState = createFixtureState(now) as unknown as Record<string, unknown>;
    delete legacyState.version;
    const providers = (legacyState.providers as ReturnType<typeof createFixtureState>["providers"]);
    providers[0]!.snapshot = {
      ...providers[0]!.snapshot!,
      source: "web-session",
      providerId: "chatgpt",
    };
    legacyState.preferences = { displayMode: "left" };
    await browser.storage.local.set({ aiLimitsState: legacyState });

    const state = await ensureState(now);

    expect(state.providers[0]?.snapshot).toEqual(providers[0]!.snapshot);
    expect(state.providers[0]?.snapshot?.providerId).toBe("chatgpt");
    expect(await loadState()).toEqual(state);
  });

  test("drops a legacy Antigravity record during migration", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 2,
        preferences: { displayMode: "used" },
        providers: [
          {
            providerId: "antigravity",
            health: {
              kind: "experimental_unavailable",
              message: "Usage data is not available yet.",
            },
          },
        ],
      },
    });

    const state = await ensureState(now);

    expect(state.providers.map(({ providerId }) => providerId)).toEqual([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
    ]);
  });

  test("whitelists persisted snapshot, quota, and credit fields", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        preferences: { displayMode: "left" },
        providers: [
          {
            providerId: "chatgpt",
            health: { kind: "connected", token: "health-secret" },
            snapshot: {
              providerId: "chatgpt",
              accountLabel: "Plus account",
              planLabel: "Plus",
              source: "web-session",
              fetchedAt: now,
              token: "snapshot-secret",
              rawResponse: { accessToken: "raw-secret" },
              windows: [
                {
                  id: "weekly",
                  label: "Weekly messages",
                  kind: "rolling",
                  usedRatio: 0.25,
                  used: 25,
                  limit: 100,
                  unit: "messages",
                  startedAt: now - day,
                  resetsAt: now + day,
                  durationMs: 2 * day,
                  sourceSemantics: "used",
                  authorization: "Bearer window-secret",
                },
              ],
              credits: [
                {
                  id: "extra",
                  label: "Extra usage",
                  unit: "USD",
                  used: 2,
                  limit: 10,
                  remaining: 8,
                  resetsAt: now + day,
                  cookie: "credit-secret",
                },
              ],
            },
          },
        ],
      },
    });

    const state = await ensureState(now);

    expect(state.providers[0]?.snapshot).toStrictEqual({
      providerId: "chatgpt",
      accountLabel: "Plus account",
      planLabel: "Plus",
      source: "web-session",
      fetchedAt: now,
      windows: [
        {
          id: "weekly",
          label: "Weekly messages",
          kind: "rolling",
          usedRatio: 0.25,
          used: 25,
          limit: 100,
          unit: "messages",
          startedAt: now - day,
          resetsAt: now + day,
          durationMs: 2 * day,
          sourceSemantics: "used",
        },
      ],
      credits: [
        {
          id: "extra",
          label: "Extra usage",
          unit: "USD",
          used: 2,
          limit: 10,
          remaining: 8,
          resetsAt: now + day,
        },
      ],
    });
    expect(await loadState()).toEqual(state);
    expect(JSON.stringify(state)).not.toMatch(/secret|token|rawResponse|authorization|cookie/);
  });

  test("drops a snapshot containing a semantically invalid quota window", async () => {
    const legacyState = createFixtureState(now) as unknown as Record<string, unknown>;
    delete legacyState.version;
    const providers = legacyState.providers as ReturnType<typeof createFixtureState>["providers"];
    providers[0]!.snapshot!.source = "web-session";
    providers[0]!.snapshot!.windows[0]!.usedRatio = 1.1;
    await browser.storage.local.set({ aiLimitsState: legacyState });

    const state = await ensureState(now);

    expect(state.providers[0]?.snapshot).toBeUndefined();
  });

  test("drops a snapshot containing a semantically invalid credit balance", async () => {
    const legacyState = createFixtureState(now) as unknown as Record<string, unknown>;
    delete legacyState.version;
    const providers = legacyState.providers as ReturnType<typeof createFixtureState>["providers"];
    providers[1]!.snapshot!.source = "web-session";
    providers[1]!.snapshot!.credits[0]!.remaining = -1;
    await browser.storage.local.set({ aiLimitsState: legacyState });

    const state = await ensureState(now);

    expect(state.providers[1]?.snapshot).toBeUndefined();
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

  test("preserves provider and snapshot identity when an updater changes IDs", async () => {
    const state = createFixtureState(now);
    state.providers[0]!.snapshot!.source = "web-session";
    await saveState(state);

    await updateProvider("chatgpt", (provider) => ({
      ...provider,
      providerId: "claude",
      snapshot: provider.snapshot
        ? { ...provider.snapshot, providerId: "cursor" }
        : undefined,
    }));

    const providers = (await loadState())?.providers;
    expect(providers?.map(({ providerId }) => providerId)).toEqual([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
    ]);
    expect(providers?.[0]?.snapshot?.providerId).toBe("chatgpt");
  });

  test("preserves identity when an updater mutates the stored record in place", async () => {
    const state = createFixtureState(now);
    state.providers[0]!.snapshot!.source = "web-session";
    await saveState(state);

    await updateProvider("chatgpt", (provider) => {
      provider.providerId = "claude";
      if (provider.snapshot) {
        provider.snapshot.providerId = "cursor";
      }
      return provider;
    });

    const providers = (await loadState())?.providers;
    expect(providers?.map(({ providerId }) => providerId)).toEqual([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
    ]);
    expect(providers?.[0]?.snapshot?.providerId).toBe("chatgpt");
  });
});
