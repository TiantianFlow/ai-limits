export interface ProviderTab {
  id?: number;
  status?: string;
  active?: boolean;
  url?: string;
}

export interface OwnedTabLease {
  tabId: number;
  createdAt: number;
}

export interface StorageSessionLike {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export type UpdatedListener = (
  tabId: number,
  changeInfo: { status?: string },
  tab: ProviderTab,
) => void;
export type RemovedListener = (tabId: number) => void;
export type ListenerCleanup = () => void;

export const OWNED_TAB_STOPPED = Symbol("owned-tab-stopped");

type BoundedResult<T> =
  | { status: "resolved"; value: T }
  | { status: "rejected" }
  | typeof OWNED_TAB_STOPPED;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function launchBestEffort(operation: () => Promise<unknown>): void {
  try {
    void operation().catch(() => undefined);
  } catch {
    // Browser APIs can throw synchronously while a worker is shutting down.
  }
}

function launchLeaseClear(
  storageSession: StorageSessionLike,
  leaseKey: string,
): void {
  launchBestEffort(() => storageSession.remove(leaseKey));
}

export function releaseOwnedBackgroundTab({
  tabId,
  leaseKey,
  removeTab,
  storageSession,
}: {
  tabId: number;
  leaseKey?: string;
  removeTab: (tabId: number) => Promise<void>;
  storageSession: StorageSessionLike;
}): void {
  launchBestEffort(() => removeTab(tabId));
  if (leaseKey !== undefined) launchLeaseClear(storageSession, leaseKey);
}

function settleBeforeBoundary<T>(
  operation: Promise<T>,
  deadline: number,
  signal: AbortSignal | undefined,
  now: () => number,
): Promise<BoundedResult<T>> {
  if (signal?.aborted) return Promise.resolve(OWNED_TAB_STOPPED);

  const remainingMs = deadline - now();
  if (remainingMs <= 0) return Promise.resolve(OWNED_TAB_STOPPED);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: BoundedResult<T>) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      resolve(result);
    };
    const stop = () => finish(OWNED_TAB_STOPPED);
    const timeout = globalThis.setTimeout(stop, remainingMs);

    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) {
      stop();
      return;
    }

    void operation.then(
      (value) => finish({ status: "resolved", value }),
      () => finish({ status: "rejected" }),
    );
  });
}

function isComplete(tab: ProviderTab | undefined): boolean {
  return tab?.status === "complete";
}

async function waitForOwnedTabReadiness({
  tabId,
  getTab,
  addUpdatedListener,
  addRemovedListener,
  signal,
  deadline,
  now,
}: {
  tabId: number;
  getTab(tabId: number): Promise<ProviderTab>;
  addUpdatedListener(listener: UpdatedListener): ListenerCleanup;
  addRemovedListener(listener: RemovedListener): ListenerCleanup;
  signal?: AbortSignal;
  deadline: number;
  now: () => number;
}): Promise<boolean> {
  if (signal?.aborted || deadline <= now()) return false;

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    let removeUpdatedListener: ListenerCleanup | undefined;
    let removeRemovedListener: ListenerCleanup | undefined;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      try {
        removeUpdatedListener?.();
      } catch {
        // Listener cleanup is best-effort during worker shutdown.
      }
      try {
        removeRemovedListener?.();
      } catch {
        // Listener cleanup is best-effort during worker shutdown.
      }
      resolve(ready);
    };
    const stop = () => finish(false);
    const onUpdated: UpdatedListener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete" || isComplete(tab)) finish(true);
    };
    const onRemoved: RemovedListener = (removedTabId) => {
      if (removedTabId === tabId) finish(false);
    };

    try {
      removeUpdatedListener = addUpdatedListener(onUpdated);
      removeRemovedListener = addRemovedListener(onRemoved);
    } catch {
      finish(false);
      return;
    }

    timeout = globalThis.setTimeout(stop, Math.max(0, deadline - now()));
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) {
      stop();
      return;
    }

    void getTab(tabId).then(
      (tab) => {
        if (isComplete(tab)) finish(true);
      },
      () => finish(false),
    );
  });
}

const DEFAULT_ABANDONED_LEASE_MAX_AGE_MS = 60_000;

export async function cleanupAbandonedOwnedTabs({
  storageSession,
  getTab,
  removeTab,
  leaseKeyPrefix,
  remainsOnOwnedUrl,
  maxAgeMs = DEFAULT_ABANDONED_LEASE_MAX_AGE_MS,
  now = Date.now,
}: {
  storageSession: StorageSessionLike;
  getTab(tabId: number): Promise<ProviderTab>;
  removeTab(tabId: number): Promise<void>;
  leaseKeyPrefix: string;
  remainsOnOwnedUrl(url: string | undefined): boolean;
  maxAgeMs?: number;
  now?: () => number;
}): Promise<void> {
  try {
    const stored = await storageSession.get(null);
    const prefixWithColon = `${leaseKeyPrefix}:`;
    const leaseEntries = Object.entries(stored).filter(
      ([key]) => key === leaseKeyPrefix || key.startsWith(prefixWithColon),
    );

    for (const [leaseKey, value] of leaseEntries) {
      try {
        const lease = parseOwnedTabLease(value);
        if (!lease) continue;

        const age = now() - lease.createdAt;
        if (age < 0 || age > maxAgeMs) continue;

        let tab: ProviderTab;
        try {
          tab = await getTab(lease.tabId);
        } catch {
          continue;
        }

        if (tab.active === false && remainsOnOwnedUrl(tab.url)) {
          try {
            await removeTab(lease.tabId);
          } catch {
            // The leased tab may already have disappeared.
          }
        }
      } finally {
        try {
          await storageSession.remove(leaseKey);
        } catch {
          // Startup cleanup is best-effort for every owned lease.
        }
      }
    }
  } catch {
    // Startup cleanup must never block normal background registration.
  }
}

export function parseOwnedTabLease(value: unknown): OwnedTabLease | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const tabId = "tabId" in value ? value.tabId : undefined;
  const createdAt = "createdAt" in value ? value.createdAt : undefined;
  if (
    typeof tabId !== "number" ||
    !Number.isInteger(tabId) ||
    tabId < 0 ||
    typeof createdAt !== "number" ||
    !Number.isFinite(createdAt)
  ) {
    return undefined;
  }

  return { tabId, createdAt };
}

export async function openOwnedBackgroundTab({
  url,
  leaseKeyPrefix,
  deadline,
  createTab,
  getTab,
  removeTab,
  addUpdatedListener,
  addRemovedListener,
  storageSession,
  signal,
  now = Date.now,
  createLeaseId = () => globalThis.crypto.randomUUID(),
}: {
  url: string;
  leaseKeyPrefix: string;
  deadline: number;
  createTab(details: { url: string; active: false }): Promise<ProviderTab>;
  getTab(tabId: number): Promise<ProviderTab>;
  removeTab(tabId: number): Promise<void>;
  addUpdatedListener(listener: UpdatedListener): ListenerCleanup;
  addRemovedListener(listener: RemovedListener): ListenerCleanup;
  storageSession: StorageSessionLike;
  signal?: AbortSignal;
  now?: () => number;
  createLeaseId?: () => string;
}): Promise<{ tabId: number; leaseKey: string } | undefined> {
  let ownedTabId: number | undefined;
  let ownedLeaseKey: string | undefined;
  let handedOff = false;
  try {
    if (signal?.aborted) return undefined;

    const createOperation = createTab({ url, active: false });
    const createResult = await settleBeforeBoundary(
      createOperation,
      deadline,
      signal,
      now,
    );
    if (createResult === OWNED_TAB_STOPPED) {
      void createOperation.then(
        (lateTab) => {
          const lateTabId = lateTab.id;
          if (lateTabId !== undefined) {
            launchBestEffort(() => removeTab(lateTabId));
          }
        },
        () => undefined,
      );
      return undefined;
    }
    if (createResult.status === "rejected") return undefined;

    const tab = createResult.value;
    if (tab.id === undefined) return undefined;
    ownedTabId = tab.id;
    const leaseKey = `${leaseKeyPrefix}:${createLeaseId()}`;
    ownedLeaseKey = leaseKey;

    const leaseWrite = storageSession.set({
      [leaseKey]: {
        tabId: ownedTabId,
        createdAt: now(),
      } satisfies OwnedTabLease,
    });
    const leaseResult = await settleBeforeBoundary(
      leaseWrite,
      deadline,
      signal,
      now,
    );
    if (leaseResult === OWNED_TAB_STOPPED) {
      void leaseWrite.then(
        () => launchLeaseClear(storageSession, leaseKey),
        () => undefined,
      );
      return undefined;
    }
    if (leaseResult.status === "rejected") return undefined;

    const ready = await waitForOwnedTabReadiness({
      tabId: ownedTabId,
      getTab,
      addUpdatedListener,
      addRemovedListener,
      signal,
      deadline,
      now,
    });
    if (!ready) return undefined;
    handedOff = true;
    return { tabId: ownedTabId, leaseKey: ownedLeaseKey };
  } catch {
    return undefined;
  } finally {
    if (!handedOff && ownedTabId !== undefined) {
      releaseOwnedBackgroundTab({
        tabId: ownedTabId,
        leaseKey: ownedLeaseKey,
        removeTab,
        storageSession,
      });
    }
  }
}

export { settleBeforeBoundary, delay };
