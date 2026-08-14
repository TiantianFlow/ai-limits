import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ProviderRefreshOutcome,
  UsageSnapshot,
} from "../domain/model";
import { observationFromUsage } from "../domain/history";
import { createFixtureState } from "../providers/fixtures";
import type { CollectionResult, ProviderAdapter } from "../providers/types";
import { loadState, saveState, setDisplayMode } from "../storage/repository";
import {
  initializeCredentialStorage,
  readProviderCredential,
  saveProviderApiKey,
} from "../storage/credentials";
import {
  disconnectProvider,
  reconcileRemovedProviderPermissions,
  reconcileProviderPermissions,
  refreshProvider,
} from "./coordinator";
import { refreshGrantedProviders } from "./refresh";

const NOW = 1_800_000_000_000;
const FINISHED_AT = NOW + 5_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function liveSnapshot(
  providerKind: UsageSnapshot["providerKind"] = "chatgpt",
): UsageSnapshot {
  return {
    providerKind,
    planLabel: "Plus",
    source: "web-session",
    fetchedAt: NOW,
    metrics: [
      {
        type: "quota",
        id: "five-hour",
        label: "5-hour messages",
        scope: "general",
        usedRatio: 0.4,
        cycle: { cadence: "rolling", resetsAt: NOW + 60_000, durationMs: 18_000_000 },
      },
    ],
  };
}

function adapter(collect: ProviderAdapter["collect"]): ProviderAdapter {
  return providerAdapter("chatgpt", collect);
}

function providerAdapter(
  id: ProviderAdapter["id"],
  collect: ProviderAdapter["collect"],
): ProviderAdapter {
  return {
    id,
    collect,
  };
}

function collectionContext() {
  return {
    fetch: vi.fn<typeof globalThis.fetch>(),
    now: NOW,
    signal: new AbortController().signal,
  };
}

function liveState(now: number) {
  const state = createFixtureState(now);
  for (const provider of state.providers) {
    provider.access = "granted";
    if (provider.snapshot) {
      provider.snapshot.source = "web-session";
    }
  }
  return state;
}

function refresh(
  provider: ProviderAdapter,
  shouldCommit: () => boolean = () => true,
) {
  return refreshProvider(
    provider,
    collectionContext(),
    "manual_provider",
    shouldCommit,
    () => FINISHED_AT,
  );
}

beforeEach(async () => {
  await browser.storage.local.clear();
  vi.restoreAllMocks();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialStorage();
});

describe("provider refresh coordinator", () => {
  test("records a next-interval backoff for scheduled temporary failures", async () => {
    const outcome = await refreshProvider(
      adapter(async () => ({
        ok: false,
        health: { kind: "temporary_error" },
      })),
      collectionContext(),
      "scheduled",
      () => true,
      () => FINISHED_AT,
    );

    expect(outcome).toEqual({
      kind: "failure",
      category: "temporary_error",
      retryAt: FINISHED_AT + 15 * 60 * 1_000,
    });
    expect((await loadState())?.providers[0]?.lastAttempt?.outcome).toEqual({
      kind: "failure",
      category: "temporary_error",
      retryAt: FINISHED_AT + 15 * 60 * 1_000,
    });
  });

  test("preserves a provider Retry-After instead of replacing it", async () => {
    const retryAt = FINISHED_AT + 60 * 60 * 1_000;

    await expect(
      refreshProvider(
        adapter(async () => ({
          ok: false,
          health: { kind: "temporary_error", retryAt },
        })),
        collectionContext(),
        "scheduled",
        () => true,
        () => FINISHED_AT,
      ),
    ).resolves.toMatchObject({ retryAt });
  });

  test("replaces only the selected snapshot and records a successful attempt", async () => {
    const initial = liveState(NOW - 60_000);
    initial.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 60_000,
      finishedAt: NOW - 59_000,
      outcome: { kind: "failure", category: "temporary_error" },
    };
    await saveState(initial, NOW);
    const claudeBefore = initial.providers[1];

    const outcome = await refresh(
      adapter(async (): Promise<CollectionResult> => ({
        ok: true,
        snapshot: liveSnapshot("claude"),
      })),
    );

    expect(outcome).toEqual({
      kind: "success",
      snapshot: { ...liveSnapshot(), fetchedAt: FINISHED_AT },
    });
    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      history: [
        ...initial.providers[0]!.history,
        observationFromUsage({ ...liveSnapshot(), fetchedAt: FINISHED_AT }),
      ],
      snapshot: { ...liveSnapshot(), fetchedAt: FINISHED_AT },
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: NOW,
        finishedAt: FINISHED_AT,
        outcome: { kind: "success" },
      },
    });
    expect((await loadState())?.providers[1]).toEqual(claudeBefore);
  });

  test("appends exactly one quota observation for a successful refresh", async () => {
    const initial = liveState(NOW - 60_000);
    const previous = observationFromUsage({
      ...liveSnapshot(),
      fetchedAt: NOW - 60_000,
    });
    initial.providers[0]!.history = [previous];
    await saveState(initial, NOW);

    await refresh(
      adapter(async () => ({ ok: true, snapshot: liveSnapshot() })),
    );

    expect((await loadState())?.providers[0]?.history).toEqual([
      previous,
      observationFromUsage({ ...liveSnapshot(), fetchedAt: FINISHED_AT }),
    ]);
  });

  test("records quota, counter, and balance samples from one successful usage snapshot", async () => {
    const initial = liveState(NOW - 60_000);
    initial.providers[0]!.history = [];
    await saveState(initial, NOW);
    const snapshot: UsageSnapshot = {
      providerKind: "chatgpt",
      source: "web-session",
      fetchedAt: NOW,
      metrics: [
        { type: "quota", id: "weekly", label: "Weekly", scope: "general", usedRatio: 0.4 },
        { type: "counter", id: "spend", label: "Spend", scope: "product", semantic: "spent", value: 12.5, unit: "USD" },
        { type: "balance", id: "credits", label: "Credits", scope: "product", value: 414, unit: "credits" },
      ],
    };

    await refresh(
      adapter(async () => ({ ok: true, snapshot })),
    );

    expect((await loadState())?.providers[0]?.history).toEqual([
      {
        observedAt: FINISHED_AT,
        metrics: [
          { type: "quota", metricId: "weekly", usedRatio: 0.4 },
          { type: "counter", metricId: "spend", semantic: "spent", value: 12.5, unit: "USD" },
          { type: "balance", metricId: "credits", value: 414, unit: "credits" },
        ],
      },
    ]);
  });

  test("does not append history for failure, deferral, permission skip, or superseded work", async () => {
    const initial = liveState(NOW - 60_000);
    const previous = observationFromUsage({
      ...liveSnapshot(),
      fetchedAt: NOW - 60_000,
    });
    initial.providers[0]!.history = [previous];
    await saveState(initial, NOW);

    await refresh(
      adapter(async () => ({
        ok: false,
        health: { kind: "temporary_error" },
      })),
    );
    await refresh(
      adapter(async () => ({
        ok: false,
        deferred: { reason: "session_required" },
      })),
    );
    await refresh(
      adapter(async () => ({
        ok: false,
        health: { kind: "permission_required" },
      })),
    );
    await refresh(
      adapter(async () => ({ ok: true, snapshot: liveSnapshot() })),
      () => false,
    );

    expect((await loadState())?.providers[0]?.history).toEqual([previous]);
  });

  test("preserves prior history when a presentation-only plan label changes", async () => {
    const initial = liveState(NOW - 60_000);
    const previous = observationFromUsage({
      ...liveSnapshot(),
      planLabel: "Plus",
      fetchedAt: NOW - 60_000,
    });
    initial.providers[0]!.snapshot = {
      ...liveSnapshot(),
      planLabel: "Plus",
      fetchedAt: NOW - 60_000,
    };
    initial.providers[0]!.history = [previous];
    await saveState(initial, NOW);

    await refresh(
      adapter(async () => ({
        ok: true,
        snapshot: { ...liveSnapshot(), planLabel: "Team" },
      })),
    );

    expect((await loadState())?.providers[0]?.history).toEqual([
      previous,
      observationFromUsage({
        ...liveSnapshot(),
        planLabel: "Team",
        fetchedAt: FINISHED_AT,
      }),
    ]);
  });

  test("sanitizes a successful snapshot before coordinator outcomes and aggregate reports", async () => {
    let coordinatorOutcome: ProviderRefreshOutcome | undefined;
    const report = await refreshGrantedProviders(
      ["chatgpt"],
      async () => true,
      async () => {
        const outcome = await refresh(
          adapter(async () => ({
            ok: true,
            snapshot: {
              ...liveSnapshot(),
              accountLabel: "person@example.com",
              accessToken: "secret-bearing snapshot field",
            } as UsageSnapshot,
          })),
        );
        coordinatorOutcome = outcome;
        return outcome;
      },
      "manual_all",
      () => FINISHED_AT,
    );
    const expectedSnapshot = { ...liveSnapshot(), fetchedAt: FINISHED_AT };

    expect(coordinatorOutcome).toStrictEqual({
      kind: "success",
      snapshot: expectedSnapshot,
    });
    expect(report.providers.chatgpt).toStrictEqual({
      kind: "success",
      snapshot: expectedSnapshot,
    });
    expect(JSON.stringify({ coordinatorOutcome, report })).not.toMatch(
      /person@example|secret-bearing/,
    );
  });

  test("rejects duplicate metric IDs before persisting snapshot or history", async () => {
    const duplicateMetrics = [
      liveSnapshot().metrics[0]!,
      { ...liveSnapshot().metrics[0]! },
    ];

    const outcome = await refresh(
      adapter(async () => ({
        ok: true,
        snapshot: { ...liveSnapshot(), metrics: duplicateMetrics },
      })),
    );

    expect(outcome).toEqual({
      kind: "failure",
      category: "provider_changed",
    });
    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: NOW,
        finishedAt: FINISHED_AT,
        outcome: { kind: "failure", category: "provider_changed" },
      },
    });
  });

  test("preserves last-good data while recording a sanitized failure", async () => {
    const initial = liveState(NOW - 60_000);
    await saveState(initial, NOW);
    const snapshotBefore = initial.providers[0]?.snapshot;

    const outcome = await refresh(
      adapter(async () => ({
        ok: false,
        health: {
          kind: "provider_changed",
          message: "secret-bearing provider response",
        },
      })),
    );

    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      history: initial.providers[0]!.history,
      snapshot: snapshotBefore,
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: NOW,
        finishedAt: FINISHED_AT,
        outcome: {
          kind: "failure",
          category: "provider_changed",
          message: "AI Limits could not read this provider's usage response.",
        },
      },
    });
    expect(outcome).toEqual({
      kind: "failure",
      category: "provider_changed",
      message: "AI Limits could not read this provider's usage response.",
    });
    expect(JSON.stringify(await loadState())).not.toContain("secret-bearing");
  });

  test("preserves allowlisted Kimi recovery guidance in coordinator and aggregate reports", async () => {
    const guidance =
      "Kimi was still starting. Try Refresh once more, or open or reload Kimi.";
    let coordinatorOutcome: ProviderRefreshOutcome | undefined;

    const report = await refreshGrantedProviders(
      ["kimi"],
      async () => true,
      async () => {
        const outcome = await refresh(
          providerAdapter("kimi", async () => ({
            ok: false,
            health: { kind: "temporary_error", message: guidance },
          })),
        );
        coordinatorOutcome = outcome;
        return outcome;
      },
      "manual_all",
      () => FINISHED_AT,
    );

    expect(coordinatorOutcome).toEqual({
      kind: "failure",
      category: "temporary_error",
      message: guidance,
    });
    expect(report.providers.kimi).toEqual({
      kind: "failure",
      category: "temporary_error",
      message: guidance,
    });
  });

  test("preserves last-good data while recording a provider session deferral", async () => {
    const initial = liveState(NOW - 60_000);
    await saveState(initial, NOW);
    const snapshotBefore = initial.providers[0]?.snapshot;

    const outcome = await refresh(
      adapter(async () => ({
        ok: false,
        deferred: { reason: "session_required" },
      })),
    );

    expect(outcome).toEqual({
      kind: "deferred",
      reason: "session_required",
    });
    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      history: initial.providers[0]!.history,
      snapshot: snapshotBefore,
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: NOW,
        finishedAt: FINISHED_AT,
        outcome: {
          kind: "deferred",
          reason: "session_required",
        },
      },
    });
  });

  test("contains thrown adapter details as a safe temporary failure", async () => {
    const initial = liveState(NOW - 60_000);
    await saveState(initial, NOW);

    const outcome = await refresh(
      adapter(async () => {
        throw new Error("secret-bearing provider failure");
      }),
    );

    expect(outcome).toEqual({ kind: "failure", category: "temporary_error" });
    expect((await loadState())?.providers[0]?.lastAttempt?.outcome).toEqual({
      kind: "failure",
      category: "temporary_error",
    });
    expect(JSON.stringify(await loadState())).not.toContain("secret-bearing");
  });

  test("commits against fresh repository state without clobbering a preference update", async () => {
    await saveState(liveState(NOW - 60_000), NOW);
    let finishCollection!: (result: CollectionResult) => void;
    const collect = vi.fn(
      () =>
        new Promise<CollectionResult>((resolve) => {
          finishCollection = resolve;
        }),
    );

    const refreshing = refresh(adapter(collect));
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    await setDisplayMode("left");
    finishCollection({ ok: true, snapshot: liveSnapshot() });
    await refreshing;

    expect((await loadState())?.preferences.displayMode).toBe("left");
  });

  test("retains concurrent successful results for different providers", async () => {
    await saveState(liveState(NOW - 60_000), NOW);

    await Promise.all([
      refresh(
        providerAdapter("chatgpt", async () => ({
          ok: true,
          snapshot: liveSnapshot("chatgpt"),
        })),
      ),
      refresh(
        providerAdapter("claude", async () => ({
          ok: true,
          snapshot: liveSnapshot("claude"),
        })),
      ),
    ]);

    const providers = (await loadState())?.providers;
    expect(providers?.find(({ providerId }) => providerId === "chatgpt")).toMatchObject({
      providerId: "chatgpt",
      snapshot: { providerKind: "chatgpt", fetchedAt: FINISHED_AT },
      lastAttempt: { outcome: { kind: "success" } },
    });
    expect(providers?.find(({ providerId }) => providerId === "claude")).toMatchObject({
      providerId: "claude",
      snapshot: { providerKind: "claude", fetchedAt: FINISHED_AT },
      lastAttempt: { outcome: { kind: "success" } },
    });
  });

  test("does not persist an older result or attempt after a newer generation takes ownership", async () => {
    await saveState(liveState(NOW - 60_000), NOW);
    let currentGeneration = 1;
    let finishOlderCollection!: (result: CollectionResult) => void;
    const olderCollection = vi.fn(
      () =>
        new Promise<CollectionResult>((resolve) => {
          finishOlderCollection = resolve;
        }),
    );

    const olderRefresh = refresh(
      adapter(olderCollection),
      () => currentGeneration === 1,
    );
    await vi.waitFor(() => expect(olderCollection).toHaveBeenCalledTimes(1));

    currentGeneration = 2;
    await refresh(
      adapter(async () => ({
        ok: true,
        snapshot: { ...liveSnapshot(), planLabel: "Newer" },
      })),
      () => currentGeneration === 2,
    );
    finishOlderCollection({
      ok: true,
      snapshot: { ...liveSnapshot(), planLabel: "Older" },
    });
    const olderOutcome = await olderRefresh;

    expect((await loadState())?.providers[0]).toMatchObject({
      snapshot: { planLabel: "Newer" },
      lastAttempt: { outcome: { kind: "success" } },
    });
    expect(olderOutcome).toEqual({ kind: "skipped", reason: "superseded" });
  });

  test("clears stored provider data when authoritative permission is absent", async () => {
    const initial = liveState(NOW);
    initial.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(initial, NOW);
    const contains = vi
      .spyOn(browser.permissions, "contains")
      .mockImplementation(async ({ origins }) =>
        (origins?.[0] !== "https://chatgpt.com/*") as never,
      );

    await reconcileProviderPermissions([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
    ]);

    expect(contains).toHaveBeenCalledTimes(4);
    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
    });
    expect(
      (await loadState())?.providers.slice(1).map(({ access }) => access),
    ).toEqual(["granted", "granted", "granted", "granted", "granted"]);
  });

  test("invalidates an exact permission removal before authoritative cleanup", async () => {
    const initial = liveState(NOW);
    initial.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(initial, NOW);
    const invalidated = new Set<string>();
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async ({ origins }) => {
        if (origins?.[0] === "https://chatgpt.com/*") {
          expect(invalidated.has("chatgpt")).toBe(true);
          return false as never;
        }
        return true as never;
      },
    );

    await reconcileRemovedProviderPermissions(
      { origins: ["https://chatgpt.com/*"] },
      ["chatgpt", "claude", "kimi", "cursor"],
      (providerId) => invalidated.add(providerId),
    );

    expect([...invalidated]).toEqual(["chatgpt"]);
    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "required",
      history: [],
    });
    expect((await loadState())?.providers[1]).toEqual(initial.providers[1]);
  });

  test("external permission removal deletes API-key credentials and provider data", async () => {
    const initial = liveState(NOW);
    await saveState(initial, NOW);
    await saveProviderApiKey("elevenlabs", "synthetic-removed-key");
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);

    await reconcileRemovedProviderPermissions(
      { origins: ["https://api.elevenlabs.io/*"] },
      ["elevenlabs"],
      () => undefined,
    );

    expect(await readProviderCredential("elevenlabs")).toBeUndefined();
    expect((await loadState())?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("clears removal-event data across a rapid regrant and blocks stale work", async () => {
    const initial = liveState(NOW);
    initial.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(initial, NOW);
    const pending = deferred<CollectionResult>();
    const collect = vi.fn(() => pending.promise);
    let isCurrentGeneration = true;
    const refreshing = refresh(adapter(collect), () => isCurrentGeneration);
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);

    await reconcileRemovedProviderPermissions(
      { origins: ["https://chatgpt.com/*"] },
      ["chatgpt"],
      () => {
        isCurrentGeneration = false;
      },
    );
    pending.resolve({
      ok: true,
      snapshot: { ...liveSnapshot(), planLabel: "Stale refresh" },
    });

    await expect(refreshing).resolves.toEqual({
      kind: "skipped",
      reason: "superseded",
    });
    expect((await loadState())?.providers[0]).toEqual({
      providerId: "chatgpt",
      access: "granted",
      history: [],
    });
  });

  test("ignores an older authority sample that resolves after a newer sample", async () => {
    await saveState(createFixtureState(NOW), NOW);
    const older = deferred<boolean>();
    const newer = deferred<boolean>();
    vi.spyOn(browser.permissions, "contains")
      .mockImplementationOnce(() => older.promise as never)
      .mockImplementationOnce(() => newer.promise as never);

    const olderReconciliation = reconcileProviderPermissions(["chatgpt"]);
    const newerReconciliation = reconcileProviderPermissions(["chatgpt"]);
    newer.resolve(true);
    await newerReconciliation;
    older.resolve(false);
    await olderReconciliation;

    expect((await loadState())?.providers[0]).toEqual(
      createFixtureState(NOW).providers[0],
    );
  });

  test("disconnect deletes local credential and provider data before awaited permission removal", async () => {
    const initial = liveState(NOW);
    initial.providers[4]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(initial, NOW);
    await saveProviderApiKey("elevenlabs", "synthetic-disconnect-key");
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    const permissionRemoval = deferred<boolean>();
    const remove = vi.spyOn(browser.permissions, "remove").mockImplementation(
      () => permissionRemoval.promise as never,
    );

    const disconnecting = disconnectProvider("elevenlabs", []);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());

    expect(await readProviderCredential("elevenlabs")).toBeUndefined();
    expect((await loadState())?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });

    permissionRemoval.resolve(true);
    await expect(disconnecting).resolves.toEqual({
      ok: true,
      localDataDeleted: true,
    });
  });

  test.each(["returns false", "rejects"] as const)(
    "deletes local data and credentials when permission cleanup %s",
    async (failureMode) => {
    const initial = liveState(NOW);
    await saveState(initial, NOW);
      await saveProviderApiKey("elevenlabs", "synthetic-disconnect-key");
      const remove = vi.spyOn(browser.permissions, "remove");
      if (failureMode === "returns false") {
        remove.mockImplementation(async () => false as never);
      } else {
        remove.mockRejectedValue(new Error("Chrome permission failure"));
      }

      await expect(disconnectProvider("elevenlabs", [])).resolves.toEqual({
        ok: false,
        error: "permission_removal_failed",
        localDataDeleted: true,
      });

      expect(await readProviderCredential("elevenlabs")).toBeUndefined();
      expect((await loadState())?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    },
  );
});
