import { afterEach, describe, expect, test, vi } from "vitest";

import { readKimiAccessTokenAtExpectedOrigin } from "./page-session";
import {
  KIMI_RECOVERY_LEASE_KEY,
  KIMI_RECOVERY_TIMEOUT_MS,
  KIMI_TOKEN_STABLE_MS,
  cleanupAbandonedKimiRecoveryTab,
  createKimiRecoveryAfterStartupCleanup,
  findKimiPageAccessToken,
  refreshKimiAccessTokenInTemporaryTab,
} from "./session-recovery";

type Tab = {
  id?: number;
  status?: string;
  active?: boolean;
  url?: string;
};

type UpdatedListener = (
  tabId: number,
  changeInfo: { status?: string },
  tab: Tab,
) => void;
type RemovedListener = (tabId: number) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function storageSession(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    values,
    get: vi.fn(async (key: string | null) =>
      key === null ? { ...values } : { [key]: values[key] },
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
}

function recoveryHarness(overrides: Record<string, unknown> = {}) {
  const updatedListeners = new Set<UpdatedListener>();
  const removedListeners = new Set<RemovedListener>();
  const session = storageSession();
  const removeTab = vi.fn().mockResolvedValue(undefined);

  return {
    updatedListeners,
    removedListeners,
    session,
    removeTab,
    dependencies: {
      createTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "loading",
        active: false,
        url: "https://www.kimi.com/",
      }),
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "loading",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn().mockResolvedValue(undefined),
      removeTab,
      addUpdatedListener: vi.fn((listener: UpdatedListener) => {
        updatedListeners.add(listener);
        return () => updatedListeners.delete(listener);
      }),
      addRemovedListener: vi.fn((listener: RemovedListener) => {
        removedListeners.add(listener);
        return () => removedListeners.delete(listener);
      }),
      storageSession: session,
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Kimi page session", () => {
  test("does not begin a new recovery until startup lease cleanup settles", async () => {
    const startupCleanup = deferred<void>();
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
    const guardedRecovery = createKimiRecoveryAfterStartupCleanup({
      startupCleanup: startupCleanup.promise,
      recoverAccessToken,
    });

    const result = guardedRecovery("stale-token");
    await Promise.resolve();
    expect(recoverAccessToken).not.toHaveBeenCalled();

    startupCleanup.resolve();
    await expect(result).resolves.toBe("fresh-token");
    expect(recoverAccessToken).toHaveBeenCalledOnce();
    expect(recoverAccessToken).toHaveBeenCalledWith("stale-token");
  });

  test("returns the first non-empty token from an already-open Kimi tab without owning its lifecycle", async () => {
    const readAccessToken = vi.fn(async (tabId: number) => {
      if (tabId === 7) throw new Error("tab closed during inspection");
      return tabId === 9 ? "  page-token  " : undefined;
    });

    await expect(
      findKimiPageAccessToken({
        queryTabs: async () => [{ id: 7 }, { id: undefined }, { id: 9 }],
        readAccessToken,
      }),
    ).resolves.toBe("page-token");
    expect(readAccessToken).toHaveBeenCalledTimes(2);
  });

  test("returns undefined when no open tab exposes a token", async () => {
    await expect(
      findKimiPageAccessToken({
        queryTabs: async () => [{ id: 4 }],
        readAccessToken: async () => "   ",
      }),
    ).resolves.toBeUndefined();
  });

  test("waits for its exact tab to complete, then polls for a delayed token", async () => {
    vi.useFakeTimers();
    const readAccessToken = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(" fresh-token ");
    const harness = recoveryHarness({ readAccessToken });

    const result = refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      rejectedToken: "stale-token",
    });
    await vi.advanceTimersByTimeAsync(0);

    for (const listener of harness.updatedListeners) {
      listener(999, { status: "complete" }, { id: 999, status: "complete" });
      listener(42, { status: "loading" }, { id: 42, status: "loading" });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(readAccessToken).not.toHaveBeenCalled();

    for (const listener of harness.updatedListeners) {
      listener(42, { status: "complete" }, { id: 42, status: "complete" });
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(readAccessToken).toHaveBeenCalledTimes(2);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);

    await expect(result).resolves.toBe("fresh-token");
    expect(readAccessToken.mock.calls.length).toBeGreaterThan(2);
    const writtenLease = harness.session.set.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(writtenLease)).toEqual([
      expect.stringMatching(/^kimiRecoveryTabLease:/),
    ]);
    expect(Object.values(writtenLease)).toEqual([
      { tabId: 42, createdAt: expect.any(Number) },
    ]);
    expect(harness.session.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^kimiRecoveryTabLease:/),
    );
    expect(harness.removeTab).toHaveBeenCalledOnce();
    expect(harness.removeTab).toHaveBeenCalledWith(42);
    expect(harness.updatedListeners).toHaveLength(0);
    expect(harness.removedListeners).toHaveLength(0);
  });

  test("holds an unchanged token until it has stayed the same after the page can refresh", async () => {
    vi.useFakeTimers();
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn().mockResolvedValue("new-token"),
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS - 1);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("new-token");
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("returns a replacement token without waiting out the rest of the stability window", async () => {
    vi.useFakeTimers();
    const readAccessToken = vi
      .fn()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValue("fresh-token");
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken,
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe("fresh-token");
    expect(readAccessToken).toHaveBeenCalledTimes(3);
  });

  test("stops when the owned tab is removed while readiness is pending", async () => {
    const harness = recoveryHarness();
    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.waitFor(() => expect(harness.removedListeners.size).toBe(1));

    for (const listener of harness.removedListeners) listener(42);

    await expect(result).resolves.toBeUndefined();
    expect(harness.removeTab).toHaveBeenCalledWith(42);
    expect(harness.session.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^kimiRecoveryTabLease:/),
    );
  });

  test("times out the combined readiness and token wait at the recovery deadline", async () => {
    vi.useFakeTimers();
    const harness = recoveryHarness();
    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);

    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS - 1);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeUndefined();
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("returns at the recovery deadline when tab creation never settles", async () => {
    vi.useFakeTimers();
    const completion = vi.fn();
    const harness = recoveryHarness({
      createTab: vi.fn(() => new Promise(() => undefined)),
    });

    void refreshKimiAccessTokenInTemporaryTab(harness.dependencies).then(
      completion,
    );
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS - 1);
    expect(completion).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(completion).toHaveBeenCalledWith(undefined);
    expect(harness.removeTab).not.toHaveBeenCalled();
  });

  test("returns at the recovery deadline and cleans up a tab that is created late", async () => {
    vi.useFakeTimers();
    const lateTab = deferred<Tab>();
    const completion = vi.fn();
    const harness = recoveryHarness({
      createTab: vi.fn(() => lateTab.promise),
    });

    void refreshKimiAccessTokenInTemporaryTab(harness.dependencies).then(
      completion,
    );
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS);
    expect(completion).toHaveBeenCalledWith(undefined);

    lateTab.resolve({
      id: 77,
      status: "complete",
      active: false,
      url: "https://www.kimi.com/",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.removeTab).toHaveBeenCalledWith(77);
    expect(harness.session.remove).not.toHaveBeenCalled();
  });

  test("returns at the recovery deadline when the lease write never settles", async () => {
    vi.useFakeTimers();
    const completion = vi.fn();
    const harness = recoveryHarness();
    harness.session.set.mockImplementation(
      () => new Promise(() => undefined),
    );

    void refreshKimiAccessTokenInTemporaryTab(harness.dependencies).then(
      completion,
    );
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS);

    expect(completion).toHaveBeenCalledWith(undefined);
    expect(harness.removeTab).toHaveBeenCalledWith(42);
    expect(harness.session.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^kimiRecoveryTabLease:/),
    );
  });

  test("clears a lease again when its timed-out write resolves late", async () => {
    vi.useFakeTimers();
    const leaseWrite = deferred<void>();
    const completion = vi.fn();
    const harness = recoveryHarness();
    harness.session.set.mockImplementation(async (items) => {
      await leaseWrite.promise;
      Object.assign(harness.session.values, items);
    });

    void refreshKimiAccessTokenInTemporaryTab(harness.dependencies).then(
      completion,
    );
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS);
    expect(completion).toHaveBeenCalledWith(undefined);
    expect(Object.keys(harness.session.values)).toHaveLength(0);

    leaseWrite.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(harness.session.values)).toHaveLength(0);
    expect(harness.session.remove).toHaveBeenCalledTimes(2);
  });

  test("late cleanup from a prior recovery preserves the next recovery lease and tab", async () => {
    vi.useFakeTimers();
    const firstLeaseWrite = deferred<void>();
    const completionA = vi.fn();
    const controllerB = new AbortController();
    const harness = recoveryHarness({
      createTab: vi
        .fn()
        .mockResolvedValueOnce({
          id: 41,
          status: "loading",
          active: false,
          url: "https://www.kimi.com/",
        })
        .mockResolvedValueOnce({
          id: 42,
          status: "loading",
          active: false,
          url: "https://www.kimi.com/",
        }),
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "loading",
        active: false,
        url: "https://www.kimi.com/",
      }),
    });
    let leaseWriteCount = 0;
    harness.session.set.mockImplementation(async (items) => {
      leaseWriteCount += 1;
      if (leaseWriteCount === 1) await firstLeaseWrite.promise;
      Object.assign(harness.session.values, items);
    });

    void refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      createLeaseId: () => "recovery-a",
    }).then(completionA);
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS);
    expect(completionA).toHaveBeenCalledWith(undefined);

    const resultB = refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      createLeaseId: () => "recovery-b",
      signal: controllerB.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.values(harness.session.values)).toContainEqual(
      expect.objectContaining({ tabId: 42 }),
    );

    firstLeaseWrite.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(Object.values(harness.session.values)).toContainEqual(
      expect.objectContaining({ tabId: 42 }),
    );
    expect(Object.values(harness.session.values)).not.toContainEqual(
      expect.objectContaining({ tabId: 41 }),
    );
    expect(harness.removeTab).not.toHaveBeenCalledWith(42);

    controllerB.abort();
    await expect(resultB).resolves.toBeUndefined();
  });

  test("returns a recovered token without awaiting stuck final cleanup", async () => {
    vi.useFakeTimers();
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn().mockResolvedValue("fresh-token"),
      removeTab: vi.fn(() => new Promise(() => undefined)),
    });
    harness.session.remove.mockImplementation(
      () => new Promise(() => undefined),
    );

    const result = Promise.race([
      refreshKimiAccessTokenInTemporaryTab(harness.dependencies),
      new Promise<string>((resolve) =>
        globalThis.setTimeout(
          () => resolve("still-pending"),
          KIMI_TOKEN_STABLE_MS + 1_000,
        ),
      ),
    ]);
    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);

    await expect(result).resolves.toBe("fresh-token");
  });

  test("aborts readiness and still clears the lease and closes the owned tab", async () => {
    const controller = new AbortController();
    const harness = recoveryHarness();
    const result = refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(harness.updatedListeners.size).toBe(1));

    controller.abort();

    await expect(result).resolves.toBeUndefined();
    expect(harness.session.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^kimiRecoveryTabLease:/),
    );
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("retries a token injection failure instead of closing the owned tab", async () => {
    vi.useFakeTimers();
    const readAccessToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("frame removed during refresh"))
      .mockResolvedValue("fresh-token");
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken,
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);
    await expect(result).resolves.toBe("fresh-token");
    expect(harness.removeTab).toHaveBeenCalledTimes(1);
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("keeps the owned tab through repeated injection failures until the deadline", async () => {
    vi.useFakeTimers();
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi
        .fn()
        .mockRejectedValue(new Error("script injection failed")),
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS - 1);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeUndefined();
    expect(harness.removeTab).toHaveBeenCalledTimes(1);
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("does not lose a recovered token when final tab removal fails", async () => {
    vi.useFakeTimers();
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn().mockResolvedValue("fresh-token"),
      removeTab: vi.fn().mockRejectedValue(new Error("tab already closed")),
    });

    const result = refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      rejectedToken: "stale-token",
    });
    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);

    await expect(result).resolves.toBe("fresh-token");
    expect(harness.session.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^kimiRecoveryTabLease:/),
    );
  });

  test("ignores an unchanged rejected token until a changed token stays available", async () => {
    vi.useFakeTimers();
    const readAccessToken = vi
      .fn()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValue("new-token");
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken,
    });

    const result = refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      rejectedToken: "stale-token",
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);
    await expect(result).resolves.toBe("new-token");
  });

  test("does not accept a stored token until Kimi reports the client app mounted", async () => {
    vi.useFakeTimers();
    let mounted = false;
    const storage = { getItem: vi.fn(() => "stored-token") };
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn(async () =>
        readKimiAccessTokenAtExpectedOrigin(
          "https://www.kimi.com",
          storage,
          "https://www.kimi.com",
          mounted,
        ),
      ),
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(harness.removeTab).not.toHaveBeenCalled();

    mounted = true;
    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS + 1_000);
    await expect(result).resolves.toBe("stored-token");
    expect(storage.getItem).toHaveBeenCalledWith("access_token");
  });

  test("drops a candidate when injection fails before the token has settled", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn(async () => {
        calls += 1;
        if (calls === 2) throw new Error("frame removed");
        return "fresh-token";
      }),
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KIMI_TOKEN_STABLE_MS);
    await expect(result).resolves.toBe("fresh-token");
  });

  test("keeps a token that appears with less time left than the stability window", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn(async () =>
        Date.now() < startedAt + KIMI_RECOVERY_TIMEOUT_MS - 500
          ? undefined
          : "late-token",
      ),
    });

    const result = refreshKimiAccessTokenInTemporaryTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(KIMI_RECOVERY_TIMEOUT_MS);

    await expect(result).resolves.toBe("late-token");
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("does not return a token seen before an abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const harness = recoveryHarness({
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "complete",
        active: false,
        url: "https://www.kimi.com/",
      }),
      readAccessToken: vi.fn().mockResolvedValue("fresh-token"),
    });

    const result = refreshKimiAccessTokenInTemporaryTab({
      ...harness.dependencies,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();

    await expect(result).resolves.toBeUndefined();
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });
});

describe("abandoned Kimi recovery lease cleanup", () => {
  const NOW = 2_000_000;

  test("enumerates ownership-specific leases and cleans each key independently", async () => {
    const session = storageSession({
      "kimiRecoveryTabLease:recovery-a": {
        tabId: 55,
        createdAt: NOW - 5_000,
      },
      "kimiRecoveryTabLease:recovery-b": {
        tabId: 56,
        createdAt: NOW - 5_000,
      },
    });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await cleanupAbandonedKimiRecoveryTab({
      storageSession: session,
      getTab: vi.fn(async (tabId: number) => ({
        id: tabId,
        active: tabId === 56,
        url: "https://www.kimi.com/",
      })),
      removeTab,
      now: () => NOW,
    });

    expect(removeTab).toHaveBeenCalledOnce();
    expect(removeTab).toHaveBeenCalledWith(55);
    expect(session.remove).toHaveBeenCalledWith(
      "kimiRecoveryTabLease:recovery-a",
    );
    expect(session.remove).toHaveBeenCalledWith(
      "kimiRecoveryTabLease:recovery-b",
    );
    expect(session.values).toEqual({});
  });

  test("closes a recent inactive leased tab that remains on Kimi", async () => {
    const session = storageSession({
      [KIMI_RECOVERY_LEASE_KEY]: { tabId: 55, createdAt: NOW - 5_000 },
    });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await cleanupAbandonedKimiRecoveryTab({
      storageSession: session,
      getTab: vi.fn().mockResolvedValue({
        id: 55,
        active: false,
        url: "https://www.kimi.com/chat/example",
      }),
      removeTab,
      now: () => NOW,
    });

    expect(removeTab).toHaveBeenCalledWith(55);
    expect(session.remove).toHaveBeenCalledWith(KIMI_RECOVERY_LEASE_KEY);
  });

  test.each([
    {
      name: "old",
      lease: { tabId: 55, createdAt: NOW - 60_001 },
      tab: { id: 55, active: false, url: "https://www.kimi.com/" },
    },
    {
      name: "active",
      lease: { tabId: 55, createdAt: NOW - 5_000 },
      tab: { id: 55, active: true, url: "https://www.kimi.com/" },
    },
    {
      name: "navigated",
      lease: { tabId: 55, createdAt: NOW - 5_000 },
      tab: { id: 55, active: false, url: "https://example.com/" },
    },
  ])("clears an $name lease without closing its tab", async ({ lease, tab }) => {
    const session = storageSession({ [KIMI_RECOVERY_LEASE_KEY]: lease });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await cleanupAbandonedKimiRecoveryTab({
      storageSession: session,
      getTab: vi.fn().mockResolvedValue(tab),
      removeTab,
      now: () => NOW,
    });

    expect(removeTab).not.toHaveBeenCalled();
    expect(session.remove).toHaveBeenCalledWith(KIMI_RECOVERY_LEASE_KEY);
  });
});
