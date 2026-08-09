export const KIMI_RECOVERY_LEASE_KEY = "kimiRecoveryTabLease";

const KIMI_URL = "https://www.kimi.com/";
const KIMI_RECOVERY_TIMEOUT_MS = 10_000;
const KIMI_RECOVERY_POLL_INTERVAL_MS = 250;
const KIMI_ABANDONED_LEASE_MAX_AGE_MS = 60_000;
const RECOVERY_STOPPED = Symbol("recovery-stopped");

interface KimiTab {
  id?: number;
  status?: string;
  active?: boolean;
  url?: string;
}

interface KimiRecoveryLease {
  tabId: number;
  createdAt: number;
}

interface StorageSessionLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

type UpdatedListener = (
  tabId: number,
  changeInfo: { status?: string },
  tab: KimiTab,
) => void;
type RemovedListener = (tabId: number) => void;
type ListenerCleanup = () => void;

type BoundedResult<T> =
  | { status: "resolved"; value: T }
  | { status: "rejected" }
  | typeof RECOVERY_STOPPED;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function settleBeforeRecoveryBoundary<T>(
  operation: Promise<T>,
  deadline: number,
  signal: AbortSignal | undefined,
  now: () => number,
): Promise<BoundedResult<T>> {
  if (signal?.aborted) return Promise.resolve(RECOVERY_STOPPED);

  const remainingMs = deadline - now();
  if (remainingMs <= 0) return Promise.resolve(RECOVERY_STOPPED);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: BoundedResult<T>) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      resolve(result);
    };
    const stop = () => finish(RECOVERY_STOPPED);
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

function isComplete(tab: KimiTab | undefined): boolean {
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
  getTab(tabId: number): Promise<KimiTab>;
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

function parseRecoveryLease(value: unknown): KimiRecoveryLease | undefined {
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

export async function findKimiPageAccessToken({
  queryTabs,
  readAccessToken,
}: {
  queryTabs(): Promise<Array<{ id?: number }>>;
  readAccessToken(tabId: number): Promise<unknown>;
}): Promise<string | undefined> {
  for (const tab of await queryTabs()) {
    if (tab.id === undefined) continue;

    try {
      const value = await readAccessToken(tab.id);
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    } catch {
      // An already-open tab may close or navigate while it is inspected.
    }
  }

  return undefined;
}

export async function refreshKimiAccessTokenInTemporaryTab({
  rejectedToken,
  createTab,
  getTab,
  readAccessToken,
  removeTab,
  addUpdatedListener,
  addRemovedListener,
  storageSession,
  signal,
  wait = delay,
  now = Date.now,
}: {
  rejectedToken?: string;
  createTab(details: { url: string; active: false }): Promise<KimiTab>;
  getTab(tabId: number): Promise<KimiTab>;
  readAccessToken(tabId: number): Promise<unknown>;
  removeTab(tabId: number): Promise<void>;
  addUpdatedListener(listener: UpdatedListener): ListenerCleanup;
  addRemovedListener(listener: RemovedListener): ListenerCleanup;
  storageSession: StorageSessionLike;
  signal?: AbortSignal;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<string | undefined> {
  let ownedTabId: number | undefined;
  const deadline = now() + KIMI_RECOVERY_TIMEOUT_MS;

  try {
    if (signal?.aborted) return undefined;

    const tab = await createTab({ url: KIMI_URL, active: false });
    if (tab.id === undefined) return undefined;
    ownedTabId = tab.id;

    await storageSession.set({
      [KIMI_RECOVERY_LEASE_KEY]: {
        tabId: ownedTabId,
        createdAt: now(),
      } satisfies KimiRecoveryLease,
    });

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

    while (!signal?.aborted && now() < deadline) {
      const readResult = await settleBeforeRecoveryBoundary(
        readAccessToken(ownedTabId),
        deadline,
        signal,
        now,
      );
      if (readResult === RECOVERY_STOPPED || readResult.status === "rejected") {
        return undefined;
      }

      const token =
        typeof readResult.value === "string"
          ? readResult.value.trim()
          : undefined;
      if (token && (rejectedToken === undefined || token !== rejectedToken)) {
        return token;
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0) return undefined;
      const waitResult = await settleBeforeRecoveryBoundary(
        wait(Math.min(KIMI_RECOVERY_POLL_INTERVAL_MS, remainingMs)),
        deadline,
        signal,
        now,
      );
      if (waitResult === RECOVERY_STOPPED || waitResult.status === "rejected") {
        return undefined;
      }
    }
  } catch {
    // Recovery is bounded best-effort work and never exposes browser errors.
  } finally {
    if (ownedTabId !== undefined) {
      try {
        await removeTab(ownedTabId);
      } catch {
        // The browser or user may already have closed the owned tab.
      } finally {
        try {
          await storageSession.remove(KIMI_RECOVERY_LEASE_KEY);
        } catch {
          // Session storage can disappear while the worker is shutting down.
        }
      }
    }
  }

  return undefined;
}

export async function cleanupAbandonedKimiRecoveryTab({
  storageSession,
  getTab,
  removeTab,
  now = Date.now,
}: {
  storageSession: StorageSessionLike;
  getTab(tabId: number): Promise<KimiTab>;
  removeTab(tabId: number): Promise<void>;
  now?: () => number;
}): Promise<void> {
  try {
    const stored = await storageSession.get(KIMI_RECOVERY_LEASE_KEY);
    const lease = parseRecoveryLease(stored[KIMI_RECOVERY_LEASE_KEY]);
    if (!lease) return;

    const age = now() - lease.createdAt;
    if (age < 0 || age > KIMI_ABANDONED_LEASE_MAX_AGE_MS) return;

    let tab: KimiTab;
    try {
      tab = await getTab(lease.tabId);
    } catch {
      return;
    }

    const remainsOnKimi =
      tab.url === KIMI_URL || tab.url?.startsWith(KIMI_URL) === true;
    if (tab.active === false && remainsOnKimi) {
      try {
        await removeTab(lease.tabId);
      } catch {
        // The leased tab may already have disappeared.
      }
    }
  } catch {
    // Startup cleanup must never block normal background registration.
  } finally {
    try {
      await storageSession.remove(KIMI_RECOVERY_LEASE_KEY);
    } catch {
      // Startup cleanup is best-effort.
    }
  }
}
