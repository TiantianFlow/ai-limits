import { beforeEach, describe, expect, test } from "vitest";

import type { ProviderSnapshot } from "../domain/model";
import { createFixtureState } from "../providers/fixtures";
import { createInitialState } from "../providers/initial-state";
import {
  deleteAllLocalData,
  disconnectProviderData,
  ensureState,
  loadState,
  reconcileProviderAccess,
  saveState,
  setAutoRefresh,
  setDisplayMode,
  updateProvider,
} from "./repository";

const now = 1_700_000_000_000;
const hour = 60 * 60 * 1_000;
const day = 24 * hour;

function liveSnapshot(
  providerId: ProviderSnapshot["providerId"] = "chatgpt",
): ProviderSnapshot {
  return {
    providerId,
    accountLabel: "person@example.com",
    planLabel: "Plus",
    source: "web-session",
    fetchedAt: now - hour,
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
  };
}

function liveFixtureState() {
  const state = createFixtureState(now);
  for (const provider of state.providers) {
    if (provider.snapshot) {
      provider.snapshot.source = "web-session";
    }
  }
  return state;
}

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
    expect(
      createFixtureState(now).providers.flatMap(({ snapshot }) =>
        snapshot ? [snapshot.source] : [],
      ),
    ).toEqual(["fixture", "fixture", "fixture", "fixture"]);
  });

  test("uses exact rolling and UTC calendar boundaries", () => {
    const state = liveFixtureState();
    const chatgpt = state.providers[0]?.snapshot;
    const cursor = state.providers[3]?.snapshot;

    expect(chatgpt?.windows.find(({ id }) => id === "weekly")).toMatchObject({
      startedAt: now - 5 * day,
      resetsAt: now + 2 * day,
      durationMs: 7 * day,
    });
    expect(cursor?.windows.find(({ id }) => id === "monthly")).toMatchObject({
      startedAt: Date.UTC(2023, 10, 1),
      resetsAt: Date.UTC(2023, 11, 1),
      durationMs: Date.UTC(2023, 11, 1) - Date.UTC(2023, 10, 1),
    });
  });
});

describe("state repository", () => {
  beforeEach(async () => {
    await browser.storage.local.clear();
  });

  test("creates a clean version 3 state with automatic refresh enabled", async () => {
    const state = await ensureState(now);

    expect(state).toEqual(createInitialState());
    expect(state.version).toBe(3);
    expect(state.preferences).toEqual({
      displayMode: "used",
      autoRefresh: true,
    });
    expect(state.providers).toEqual([
      { providerId: "chatgpt", access: "required" },
      { providerId: "claude", access: "required" },
      { providerId: "kimi", access: "required" },
      { providerId: "cursor", access: "required" },
    ]);
  });

  test("persists display mode and automatic-refresh preferences independently", async () => {
    await ensureState(now);

    await setDisplayMode("left");
    await setAutoRefresh(false);

    expect((await loadState())?.preferences).toEqual({
      displayMode: "left",
      autoRefresh: false,
    });
  });

  test("defaults automatic refresh on when migrating an explicit v2 false value", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 2,
        preferences: { displayMode: "used", autoRefresh: false },
        providers: [],
      },
    });

    expect((await ensureState(now)).preferences.autoRefresh).toBe(true);
  });

  test("preserves an explicit v3 automatic-refresh false value", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 3,
        preferences: { displayMode: "used", autoRefresh: false },
        providers: [],
      },
    });

    expect((await ensureState(now)).preferences.autoRefresh).toBe(false);
  });

  test("migrates v2 snapshots and access without inventing historical attempts", async () => {
    const snapshot = liveSnapshot();
    await browser.storage.local.set({
      aiLimitsState: {
        version: 2,
        preferences: { displayMode: "left" },
        providers: [
          {
            providerId: "chatgpt",
            health: { kind: "temporary_error", message: "Retry later" },
            snapshot,
          },
          {
            providerId: "claude",
            health: { kind: "permission_required" },
          },
          {
            providerId: "kimi",
            health: { kind: "connecting" },
          },
          {
            providerId: "cursor",
            health: { kind: "signed_out", message: "Sign in" },
            snapshot: liveSnapshot("cursor"),
          },
        ],
      },
    });

    const state = await ensureState(now);

    expect(state.preferences).toEqual({ displayMode: "left", autoRefresh: true });
    expect(state.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      snapshot: {
        ...snapshot,
        accountLabel: undefined,
      },
    });
    expect(state.providers[1]).toEqual({
      providerId: "claude",
      access: "required",
    });
    expect(state.providers[2]).toEqual({
      providerId: "kimi",
      access: "granted",
    });
    expect(state.providers[3]).toEqual({
      providerId: "cursor",
      access: "granted",
      snapshot: {
        ...liveSnapshot("cursor"),
        accountLabel: undefined,
      },
    });
    expect(state.providers.every(({ lastAttempt }) => lastAttempt === undefined)).toBe(true);
  });

  test("keeps a complete forward-compatible attempt while whitelisting every field", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 2,
        preferences: { displayMode: "used", autoRefresh: false, secret: "drop" },
        providers: [
          {
            providerId: "chatgpt",
            health: { kind: "connected", token: "drop" },
            access: "required",
            lastAttempt: {
              trigger: "manual_provider",
              startedAt: now - 2_000,
              finishedAt: now - 1_000,
              trace: "drop",
              outcome: {
                kind: "failure",
                category: "temporary_error",
                message: "secret-bearing historical failure",
                retryAt: now + hour,
                rawResponse: "drop",
              },
            },
            snapshot: {
              ...liveSnapshot(),
              accountLabel: "Team account",
              token: "drop",
              rawResponse: { secret: "drop" },
              windows: [
                {
                  ...liveSnapshot().windows[0],
                  authorization: "drop",
                },
              ],
              credits: [
                {
                  ...liveSnapshot().credits[0],
                  cookie: "drop",
                },
              ],
            },
          },
        ],
      },
    });

    const state = await ensureState(now);

    expect(state.providers[0]).toStrictEqual({
      providerId: "chatgpt",
      access: "granted",
      snapshot: {
        ...liveSnapshot(),
        accountLabel: "Team account",
      },
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: now - 2_000,
        finishedAt: now - 1_000,
        outcome: {
          kind: "failure",
          category: "temporary_error",
          message: "AI Limits could not refresh this provider. Try again later.",
          retryAt: now + hour,
        },
      },
    });
    expect(JSON.stringify(state)).not.toMatch(
      /secret-bearing|token|rawResponse|authorization|cookie|trace/,
    );
  });

  test.each([
    {
      trigger: "scheduled",
      startedAt: now,
      finishedAt: now - 1,
      outcome: { kind: "success" },
    },
    {
      trigger: "unknown",
      startedAt: now - 1,
      finishedAt: now,
      outcome: { kind: "success" },
    },
    {
      trigger: "scheduled",
      startedAt: now - 1,
      finishedAt: now,
      outcome: { kind: "deferred", reason: "unknown" },
    },
    {
      trigger: "scheduled",
      startedAt: now - 1,
      finishedAt: now,
      outcome: { kind: "failure", category: "unknown" },
    },
  ])("drops malformed persisted attempts", async (lastAttempt) => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 3,
        preferences: { displayMode: "used", autoRefresh: true },
        providers: [
          {
            providerId: "chatgpt",
            access: "granted",
            lastAttempt,
          },
        ],
      },
    });

    expect((await ensureState(now)).providers[0]?.lastAttempt).toBeUndefined();
  });

  test("drops semantically invalid quota data instead of persisting a partial snapshot", async () => {
    const snapshot = liveSnapshot();
    snapshot.windows[0]!.usedRatio = 1.1;
    await browser.storage.local.set({
      aiLimitsState: {
        version: 3,
        preferences: { displayMode: "used", autoRefresh: true },
        providers: [
          { providerId: "chatgpt", access: "granted", snapshot },
        ],
      },
    });

    expect((await ensureState(now)).providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
    });
  });

  test("clears provider data when authoritative access revokes a stored grant", async () => {
    const state = liveFixtureState();
    state.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: now - 1_000,
      finishedAt: now,
      outcome: { kind: "success" },
    };
    await saveState(state);
    await reconcileProviderAccess({ chatgpt: false, claude: true });

    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
    });
    expect((await loadState())?.providers[1]?.access).toBe("granted");
  });

  test("leaves initial required provider records unchanged when access is absent", async () => {
    const state = createInitialState();
    await saveState(state);

    await reconcileProviderAccess({ chatgpt: false });

    expect(await loadState()).toEqual(state);
  });

  test("clears legacy provider data when required access remains absent", async () => {
    const state = liveFixtureState();
    state.providers[0] = {
      ...state.providers[0]!,
      access: "required",
      lastAttempt: {
        trigger: "scheduled",
        startedAt: now - 1_000,
        finishedAt: now,
        outcome: { kind: "success" },
      },
    };
    await saveState(state);

    await reconcileProviderAccess({ chatgpt: false });

    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
    });
  });

  test("explicit disconnect deletes only the selected provider's local data", async () => {
    const state = liveFixtureState();
    state.providers[0]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: now - 1_000,
      finishedAt: now,
      outcome: { kind: "failure", category: "temporary_error" },
    };
    await saveState(state);
    const claudeBefore = state.providers[1];

    await disconnectProviderData("chatgpt");

    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
    });
    expect((await loadState())?.providers[1]).toEqual(claudeBefore);
  });

  test("delete-all recreates clean v3 state without clearing unrelated local keys", async () => {
    await browser.storage.local.set({ unrelated: "keep" });
    await saveState(liveFixtureState());

    const state = await deleteAllLocalData();

    expect(state).toEqual(createInitialState());
    expect(await loadState()).toEqual(createInitialState());
    expect(await browser.storage.local.get("unrelated")).toEqual({ unrelated: "keep" });
  });

  test("updates only the requested provider and preserves provider identities", async () => {
    const state = liveFixtureState();
    await saveState(state);
    const claudeBefore = state.providers[1];

    await updateProvider("chatgpt", (provider) => ({
      ...provider,
      providerId: "claude",
      access: "required",
      snapshot: provider.snapshot
        ? { ...provider.snapshot, providerId: "cursor" }
        : undefined,
    }));

    const providers = (await loadState())?.providers;
    expect(providers?.[0]).toMatchObject({
      providerId: "chatgpt",
      access: "required",
      snapshot: { providerId: "chatgpt" },
    });
    expect(providers?.[1]).toEqual(claudeBefore);
  });

  test("normalizes mutation output before it reaches durable storage", async () => {
    await ensureState(now);

    await updateProvider("chatgpt", (provider) => ({
      ...provider,
      access: "granted",
      snapshot: {
        ...liveSnapshot(),
        rawResponse: "drop",
      } as ProviderSnapshot,
    }));

    const expected = liveSnapshot();
    delete expected.accountLabel;
    expect((await loadState())?.providers[0]?.snapshot).toStrictEqual(expected);
    expect(JSON.stringify(await loadState())).not.toMatch(/person@example|rawResponse/);
  });
});
