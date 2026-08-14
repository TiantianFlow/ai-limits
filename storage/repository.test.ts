import { beforeEach, describe, expect, test, vi } from "vitest";

import { KIMI_RECOVERY_GUIDANCE } from "../domain/model";
import type { UsageSnapshot } from "../domain/model";
import { observationFromUsage } from "../domain/history";
import { createFixtureState } from "../providers/fixtures";
import { createInitialState, migrateState } from "../providers/initial-state";
import {
  initializeCredentialStorage,
  readProviderCredential,
  saveProviderApiKey,
} from "./credentials";
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
  providerKind: UsageSnapshot["providerKind"] = "chatgpt",
): UsageSnapshot {
  return {
    providerKind,
    accountLabel: "person@example.com",
    planLabel: "Plus",
    source: "web-session",
    fetchedAt: now - hour,
    metrics: [
      {
        type: "quota",
        id: "weekly",
        label: "Weekly messages",
        scope: "general",
        usedRatio: 0.25,
        used: 25,
        limit: 100,
        unit: "messages",
        cycle: { cadence: "rolling", startedAt: now - day, resetsAt: now + day, durationMs: 2 * day },
      },
      {
        type: "counter",
        id: "extra",
        label: "Extra usage",
        scope: "product",
        semantic: "spent",
        unit: "USD",
        value: 2,
        limit: 10,
        cycle: { cadence: "calendar", resetsAt: now + day },
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
      "elevenlabs",
      "newapi",
    ]);
  });

  test("marks every fixture snapshot as a fixture", () => {
    expect(
      createFixtureState(now).providers.flatMap(({ snapshot }) =>
        snapshot ? [snapshot.source] : [],
      ),
    ).toEqual(["fixture", "fixture", "fixture", "fixture", "fixture", "fixture"]);
  });

  test("uses exact rolling and UTC calendar boundaries", () => {
    const state = liveFixtureState();
    const chatgpt = state.providers[0]?.snapshot;
    const cursor = state.providers[3]?.snapshot;

    expect(chatgpt?.metrics.find(({ id }) => id === "weekly")?.cycle).toMatchObject({
      startedAt: now - 5 * day,
      resetsAt: now + 2 * day,
      durationMs: 7 * day,
    });
    expect(cursor?.metrics.find(({ id }) => id === "monthly")?.cycle).toMatchObject({
      startedAt: Date.UTC(2023, 10, 1),
      resetsAt: Date.UTC(2023, 11, 1),
      durationMs: Date.UTC(2023, 11, 1) - Date.UTC(2023, 10, 1),
    });
  });

  test("authors one truthful usage group for every fixture snapshot", () => {
    expect(
      createFixtureState(now).providers.flatMap(({ snapshot }) =>
        snapshot ? [{ providerKind: snapshot.providerKind, usageGroups: snapshot.usageGroups }] : [],
      ),
    ).toEqual([
      {
        providerKind: "chatgpt",
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["five-hour", "weekly"],
          },
        ],
      },
      {
        providerKind: "claude",
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["weekly", "extra-usage"],
          },
        ],
      },
      {
        providerKind: "kimi",
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["five-hour", "weekly"],
          },
        ],
      },
      {
        providerKind: "cursor",
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["monthly", "on-demand"],
          },
        ],
      },
      {
        providerKind: "elevenlabs",
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: [
              "monthly-credits",
              "voice-slots",
              "professional-voice-slots",
              "voice-add-edits",
            ],
          },
        ],
      },
      {
        providerKind: "newapi",
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["relay-key-quota"],
          },
        ],
      },
    ]);
  });
});

describe("state repository", () => {
  test.each([
    [
      "credential_invalid",
      "The API key is invalid. Enter a valid key and try again.",
    ],
    [
      "credential_scope_required",
      "The API key cannot read usage. Update its permissions and try again.",
    ],
  ] as const)("persists %s without provider response details", async (category, message) => {
    const state = createInitialState();
    state.providers[4] = {
      ...state.providers[4]!,
      access: "granted",
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: now - 1_000,
        finishedAt: now,
        outcome: {
          kind: "failure",
          category,
          message: "raw provider body and synthetic-secret",
        },
      },
    };

    await saveState(state, now);

    const stored = await loadState(now);
    expect(stored?.providers[4]?.lastAttempt?.outcome).toEqual({
      kind: "failure",
      category,
      message,
    });
    expect(JSON.stringify(stored)).not.toMatch(/raw provider body|synthetic-secret/);
  });

  test("preserves the allowlisted Kimi recovery guidance across persistence", async () => {
    const state = createInitialState();
    const kimi = state.providers.find(
      (provider) => provider.providerId === "kimi",
    )!;
    kimi.access = "granted";
    kimi.lastAttempt = {
      trigger: "manual_provider",
      startedAt: now - 1_000,
      finishedAt: now,
      outcome: {
        kind: "failure",
        category: "temporary_error",
        message: KIMI_RECOVERY_GUIDANCE,
      },
    };

    await saveState(state, now);
    await expect(ensureState(now)).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "kimi",
          lastAttempt: expect.objectContaining({
            outcome: expect.objectContaining({
              message: KIMI_RECOVERY_GUIDANCE,
            }),
          }),
        }),
      ]),
    });
  });

  beforeEach(async () => {
    await browser.storage.local.clear();
    vi.restoreAllMocks();
    Object.assign(browser.storage.local, {
      setAccessLevel: vi.fn(async () => undefined),
    });
    await initializeCredentialStorage();
  });

  test("creates a clean version 4 state with automatic refresh enabled", async () => {
    const state = await ensureState(now);

    expect(state).toEqual(createInitialState());
    expect(state.version).toBe(4);
    expect(state.preferences).toEqual({
      displayMode: "used",
      autoRefresh: true,
    });
    expect(state.providers).toEqual([
      { providerId: "chatgpt", access: "required", history: [] },
      { providerId: "claude", access: "required", history: [] },
      { providerId: "kimi", access: "required", history: [] },
      { providerId: "cursor", access: "required", history: [] },
      { providerId: "elevenlabs", access: "required", history: [] },
      { providerId: "newapi", access: "required", history: [] },
    ]);
  });

  test("normalizes durable state on read without waiting for a write path", async () => {
    const stored = {
      version: 3,
      preferences: { displayMode: "left" },
      providers: [
        {
          providerId: "chatgpt",
          access: "granted",
          snapshot: liveSnapshot(),
        },
      ],
    };
    await browser.storage.local.set({ aiLimitsState: stored });
    const write = vi.spyOn(browser.storage.local, "set");

    await expect(loadState(now)).resolves.toEqual(migrateState(stored, now));
    expect(write).not.toHaveBeenCalled();
  });

  test("persists display mode and automatic-refresh preferences independently", async () => {
    await ensureState(now);

    await setDisplayMode("left");
    await setAutoRefresh(false);

    expect((await loadState(now))?.preferences).toEqual({
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

  test("defaults automatic refresh on when migrating an explicit v3 false value", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 3,
        preferences: { displayMode: "used", autoRefresh: false },
        providers: [],
      },
    });

    expect((await ensureState(now)).preferences.autoRefresh).toBe(true);
  });

  test("preserves an explicit v4 automatic-refresh false value", async () => {
    await browser.storage.local.set({
      aiLimitsState: {
        version: 4,
        preferences: { displayMode: "used", autoRefresh: false },
        providers: [],
      },
    });

    expect((await ensureState(now)).preferences.autoRefresh).toBe(false);
  });

  test("migrates a valid v3 snapshot to exactly one real history observation", () => {
    const snapshot = liveSnapshot();
    const state = migrateState(
      {
        version: 3,
        preferences: { displayMode: "used", autoRefresh: false },
        providers: [
          { providerId: "chatgpt", access: "granted", snapshot },
        ],
      },
      now,
    );

    expect(state.version).toBe(4);
    expect(state.providers[0]?.history).toEqual([
      observationFromUsage({ ...snapshot, accountLabel: undefined }),
    ]);
  });

  test("preserves explicit required access while migrating v3 records", () => {
    const state = migrateState(
      {
        version: 3,
        preferences: { displayMode: "used", autoRefresh: true },
        providers: [{ providerId: "chatgpt", access: "required" }],
      },
      now,
    );

    expect(state.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
    });
  });

  test("does not seed V3 history from a snapshot older than 30 days", () => {
    const staleSnapshot = {
      ...liveSnapshot(),
      fetchedAt: now - 30 * day - 1,
    };
    const cutoffSnapshot = {
      ...liveSnapshot("claude"),
      fetchedAt: now - 30 * day,
    };
    const state = migrateState(
      {
        version: 3,
        preferences: { displayMode: "left", autoRefresh: false },
        providers: [
          {
            providerId: "chatgpt",
            access: "granted",
            snapshot: staleSnapshot,
          },
          {
            providerId: "claude",
            access: "required",
            snapshot: cutoffSnapshot,
          },
        ],
      },
      now,
    );

    expect(state.preferences).toEqual({
      displayMode: "left",
      autoRefresh: true,
    });
    expect(state.providers[0]).toMatchObject({
      access: "granted",
      snapshot: { fetchedAt: staleSnapshot.fetchedAt },
      history: [],
    });
    expect(state.providers[1]).toMatchObject({
      access: "required",
      snapshot: { fetchedAt: cutoffSnapshot.fetchedAt },
      history: [
        expect.objectContaining({ observedAt: cutoffSnapshot.fetchedAt }),
      ],
    });
  });

  test("prunes and compacts V4 history during deterministic startup migration", async () => {
    const compactedHour = Math.floor((now - 3 * day) / hour) * hour;
    const history = [
      observationFromUsage({
        ...liveSnapshot(),
        fetchedAt: now - hour,
      }),
      observationFromUsage({
        ...liveSnapshot(),
        fetchedAt: compactedHour + 5 * 60 * 1_000,
      }),
      observationFromUsage({
        ...liveSnapshot(),
        fetchedAt: now - 31 * day,
      }),
      observationFromUsage({
        ...liveSnapshot(),
        fetchedAt: compactedHour + 55 * 60 * 1_000,
      }),
      observationFromUsage({
        ...liveSnapshot(),
        fetchedAt: now - 30 * 60 * 1_000,
      }),
    ];
    await browser.storage.local.set({
      aiLimitsState: {
        version: 4,
        preferences: { displayMode: "left", autoRefresh: false },
        providers: [
          {
            providerId: "chatgpt",
            access: "granted",
            snapshot: liveSnapshot(),
            history,
          },
        ],
      },
    });

    const provider = (await ensureState(now)).providers[0];

    expect(provider?.access).toBe("granted");
    expect((await loadState(now))?.preferences).toEqual({
      displayMode: "left",
      autoRefresh: false,
    });
    expect(provider?.history).toEqual([
      history[3],
      history[0],
      history[4],
    ]);
    expect((await loadState(now))?.providers[0]?.history).toEqual(
      provider?.history,
    );
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
    const expectedSnapshot = { ...snapshot };
    delete expectedSnapshot.accountLabel;
    const expectedCursorSnapshot = liveSnapshot("cursor");
    delete expectedCursorSnapshot.accountLabel;

    expect(state.preferences).toEqual({ displayMode: "left", autoRefresh: true });
    expect(state.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      history: [],
      snapshot: expectedSnapshot,
    });
    expect(state.providers[1]).toEqual({
      providerId: "claude",
      access: "required",
      history: [],
    });
    expect(state.providers[2]).toEqual({
      providerId: "kimi",
      access: "granted",
      history: [],
    });
    expect(state.providers[3]).toEqual({
      providerId: "cursor",
      access: "granted",
      history: [],
      snapshot: expectedCursorSnapshot,
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
              metrics: [
                {
                  ...liveSnapshot().metrics[0],
                  authorization: "drop",
                },
                {
                  ...liveSnapshot().metrics[1],
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
      history: [],
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
    const quota = snapshot.metrics[0];
    if (quota?.type === "quota") quota.usedRatio = 1.1;
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
      history: [],
    });
  });

  test("drops a current snapshot with duplicate metric IDs", async () => {
    const snapshot = liveSnapshot();
    snapshot.metrics.push({ ...snapshot.metrics[0]! });
    await browser.storage.local.set({
      aiLimitsState: {
        version: 4,
        preferences: { displayMode: "used", autoRefresh: true },
        providers: [
          {
            providerId: "chatgpt",
            access: "granted",
            history: [],
            snapshot,
          },
        ],
      },
    });

    expect((await ensureState(now)).providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      history: [],
    });
  });

  test("sanitizes stored history independently without losing a valid current snapshot", async () => {
    const snapshot = liveSnapshot();
    await browser.storage.local.set({
      aiLimitsState: {
        version: 4,
        preferences: { displayMode: "used", autoRefresh: true },
        providers: [
          {
            providerId: "chatgpt",
            access: "granted",
            snapshot,
            history: [
              {
                observedAt: now - 2 * hour,
                secret: "drop",
                metrics: [
                  {
                    type: "quota",
                    metricId: "weekly",
                    usedRatio: 0.2,
                    cycle: { cadence: "rolling", resetsAt: now + day },
                    label: "drop",
                  },
                ],
              },
              {
                observedAt: now - hour,
                metrics: [
                  { type: "quota", metricId: "weekly", usedRatio: 0.3 },
                  { type: "quota", metricId: "weekly", usedRatio: 0.4 },
                ],
              },
              {
                observedAt: Number.NaN,
                metrics: [],
              },
              {
                observedAt: now - 30 * 60 * 1_000,
                metrics: [],
              },
            ],
          },
        ],
      },
    });

    const provider = (await ensureState(now)).providers[0];
    expect(provider?.snapshot).toEqual({
      ...snapshot,
      accountLabel: undefined,
    });
    expect(provider?.history).toEqual([
      {
        observedAt: now - 2 * hour,
        metrics: [
          { type: "quota", metricId: "weekly", usedRatio: 0.2, cycle: { cadence: "rolling", resetsAt: now + day } },
        ],
      },
    ]);
    expect(JSON.stringify(provider)).not.toContain("secret");
  });

  test("clears provider data when authoritative access revokes a stored grant", async () => {
    const state = liveFixtureState();
    state.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: now - 1_000,
      finishedAt: now,
      outcome: { kind: "success" },
    };
    await saveState(state, now);
    await reconcileProviderAccess({ chatgpt: false, claude: true });

    expect((await loadState(now))?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
    });
    expect((await loadState(now))?.providers[1]?.access).toBe("granted");
  });

  test("leaves initial required provider records unchanged when access is absent", async () => {
    const state = createInitialState();
    await saveState(state, now);

    await reconcileProviderAccess({ chatgpt: false });

    expect(await loadState(now)).toEqual(state);
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
    await saveState(state, now);

    await reconcileProviderAccess({ chatgpt: false });

    expect((await loadState(now))?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
    });
  });

  test("explicit disconnect deletes only the selected provider's local data", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state = liveFixtureState();
    state.providers[0]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: now - 1_000,
      finishedAt: now,
      outcome: { kind: "failure", category: "temporary_error" },
    };
    await saveState(state, now);
    const claudeBefore = state.providers[1];

    await disconnectProviderData("chatgpt");

    expect((await loadState(now))?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
    });
    expect((await loadState(now))?.providers[1]).toEqual(claudeBefore);
  });

  test("explicit disconnect also deletes only the selected provider credential", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state = liveFixtureState();
    await saveState(state, now);
    await saveProviderApiKey("elevenlabs", "synthetic-delete-key");

    await disconnectProviderData("elevenlabs");

    expect(await readProviderCredential("elevenlabs")).toBeUndefined();
    expect((await loadState(now))?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
    expect((await loadState(now))?.providers[0]).toEqual(state.providers[0]);
  });

  test("delete-all recreates clean v4 state without clearing unrelated local keys", async () => {
    await browser.storage.local.set({ unrelated: "keep" });
    await saveState(liveFixtureState(), now);
    await saveProviderApiKey("elevenlabs", "synthetic-delete-all-key");

    const state = await deleteAllLocalData();

    expect(state).toEqual(createInitialState());
    expect(await readProviderCredential("elevenlabs")).toBeUndefined();
    expect(await loadState(now)).toEqual(createInitialState());
    expect(await browser.storage.local.get("unrelated")).toEqual({ unrelated: "keep" });
  });

  test("updates only the requested provider and preserves provider identities", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state = liveFixtureState();
    await saveState(state, now);
    const claudeBefore = state.providers[1];

    await updateProvider("chatgpt", (provider) => ({
      ...provider,
      providerId: "claude",
      access: "required",
      snapshot: provider.snapshot
        ? { ...provider.snapshot, providerKind: "cursor" }
        : undefined,
    }));

    const providers = (await loadState(now))?.providers;
    expect(providers?.[0]).toMatchObject({
      providerId: "chatgpt",
      access: "required",
      snapshot: { providerKind: "chatgpt" },
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
      } as UsageSnapshot,
    }));

    const expected = liveSnapshot();
    delete expected.accountLabel;
    expect((await loadState(now))?.providers[0]?.snapshot).toStrictEqual(expected);
    expect(JSON.stringify(await loadState(now))).not.toMatch(
      /person@example|rawResponse/,
    );
  });
});
