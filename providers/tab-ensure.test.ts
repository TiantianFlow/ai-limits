import { afterEach, describe, expect, test, vi } from "vitest";

import {
  cleanupAbandonedOwnedTabs,
  openOwnedBackgroundTab,
  releaseOwnedBackgroundTab,
  type ProviderTab,
  type RemovedListener,
  type UpdatedListener,
} from "./tab-ensure";

type Tab = ProviderTab;

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

function ownedTabHarness(overrides: Record<string, unknown> = {}) {
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
      url: "https://cursor.com/dashboard/spending",
      leaseKeyPrefix: "cursorDashboardTabLease",
      deadline: Date.now() + 10_000,
      createTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "loading",
        active: false,
        url: "https://cursor.com/dashboard/spending",
      }),
      getTab: vi.fn().mockResolvedValue({
        id: 42,
        status: "loading",
        active: false,
        url: "https://cursor.com/dashboard/spending",
      }),
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

describe("owned background tab helper", () => {
  test("creates one inactive tab, waits for it to complete, and hands it off", async () => {
    const harness = ownedTabHarness();
    const result = openOwnedBackgroundTab(harness.dependencies);
    await vi.waitFor(() => expect(harness.updatedListeners.size).toBe(1));

    for (const listener of harness.updatedListeners) {
      listener(999, { status: "complete" }, { id: 999, status: "complete" });
      listener(42, { status: "complete" }, { id: 42, status: "complete" });
    }

    await expect(result).resolves.toEqual({
      tabId: 42,
      leaseKey: expect.stringMatching(/^cursorDashboardTabLease:/),
    });
    expect(harness.dependencies.createTab).toHaveBeenCalledWith({
      url: "https://cursor.com/dashboard/spending",
      active: false,
    });
    expect(harness.removeTab).not.toHaveBeenCalled();
    expect(Object.keys(harness.session.values)).toEqual([
      expect.stringMatching(/^cursorDashboardTabLease:/),
    ]);
  });

  test("does not create a tab when the caller already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = ownedTabHarness({ signal: controller.signal });

    await expect(
      openOwnedBackgroundTab(harness.dependencies),
    ).resolves.toBeUndefined();
    expect(harness.dependencies.createTab).not.toHaveBeenCalled();
    expect(harness.removeTab).not.toHaveBeenCalled();
  });

  test("times out and removes only the owned tab", async () => {
    vi.useFakeTimers();
    const now = vi.fn(() => 1_000);
    const harness = ownedTabHarness({
      now,
      deadline: 11_000,
    });
    const result = openOwnedBackgroundTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(harness.removeTab).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeUndefined();
    expect(harness.removeTab).toHaveBeenCalledOnce();
    expect(harness.removeTab).toHaveBeenCalledWith(42);
  });

  test("removes a tab that is created after the deadline", async () => {
    vi.useFakeTimers();
    const lateTab = deferred<Tab>();
    const now = vi.fn(() => 1_000);
    const harness = ownedTabHarness({
      now,
      deadline: 11_000,
      createTab: vi.fn(() => lateTab.promise),
    });

    const result = openOwnedBackgroundTab(harness.dependencies);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeUndefined();

    lateTab.resolve({
      id: 77,
      status: "complete",
      active: false,
      url: "https://cursor.com/dashboard/spending",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.removeTab).toHaveBeenCalledWith(77);
  });

  test("releaseOwnedBackgroundTab removes only the leased tab", () => {
    const session = storageSession({
      "cursorDashboardTabLease:owned": { tabId: 42, createdAt: 1 },
    });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    releaseOwnedBackgroundTab({
      tabId: 42,
      leaseKey: "cursorDashboardTabLease:owned",
      removeTab,
      storageSession: session,
    });

    expect(removeTab).toHaveBeenCalledOnce();
    expect(removeTab).toHaveBeenCalledWith(42);
  });
});

describe("abandoned owned-tab cleanup", () => {
  const NOW = 2_000_000;

  test("closes a recent inactive leased tab that remains on the owned URL", async () => {
    const session = storageSession({
      "cursorDashboardTabLease:owned": { tabId: 55, createdAt: NOW - 5_000 },
    });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await cleanupAbandonedOwnedTabs({
      storageSession: session,
      getTab: vi.fn().mockResolvedValue({
        id: 55,
        active: false,
        url: "https://cursor.com/dashboard/spending",
      }),
      removeTab,
      now: () => NOW,
      leaseKeyPrefix: "cursorDashboardTabLease",
      remainsOnOwnedUrl: (url) =>
        url === "https://cursor.com/dashboard/spending",
    });

    expect(removeTab).toHaveBeenCalledWith(55);
    expect(session.remove).toHaveBeenCalledWith(
      "cursorDashboardTabLease:owned",
    );
  });

  test("does not close an active or navigated user tab", async () => {
    const session = storageSession({
      "cursorDashboardTabLease:active": { tabId: 8, createdAt: NOW - 1_000 },
      "cursorDashboardTabLease:navigated": { tabId: 9, createdAt: NOW - 1_000 },
    });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await cleanupAbandonedOwnedTabs({
      storageSession: session,
      getTab: vi.fn(async (tabId: number) =>
        tabId === 8
          ? { id: 8, active: true, url: "https://cursor.com/dashboard/spending" }
          : { id: 9, active: false, url: "https://cursor.com/dashboard" },
      ),
      removeTab,
      now: () => NOW,
      leaseKeyPrefix: "cursorDashboardTabLease",
      remainsOnOwnedUrl: (url) =>
        url === "https://cursor.com/dashboard/spending",
    });

    expect(removeTab).not.toHaveBeenCalled();
    expect(session.values).toEqual({});
  });
});
