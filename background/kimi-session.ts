export const KIMI_RECOVERY_LEASE_KEY = "kimiRecoveryTabLease";

const KIMI_URL = "https://www.kimi.com/";
const KIMI_RECOVERY_LEASE_KEY_PREFIX = `${KIMI_RECOVERY_LEASE_KEY}:`;
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
  get(key: string | null): Promise<Record<string, unknown>>;
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

function launchOwnedTabCleanup(
  tabId: number,
  leaseKey: string,
  removeTab: (tabId: number) => Promise<void>,
  storageSession: StorageSessionLike,
): void {
  launchBestEffort(() => removeTab(tabId));
  launchLeaseClear(storageSession, leaseKey);
}

function createKimiRecoveryLeaseKey(createLeaseId: () => string): string {
  return `${KIMI_RECOVERY_LEASE_KEY_PREFIX}${createLeaseId()}`;
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

function waitForStartupCleanup(
  startupCleanup: Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (canRecover: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);
      resolve(canRecover);
    };
    const stop = () => finish(false);

    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) {
      stop();
      return;
    }

    void startupCleanup.then(
      () => finish(true),
      () => finish(true),
    );
  });
}

export function createKimiRecoveryAfterStartupCleanup({
  startupCleanup,
  recoverAccessToken,
  signal,
}: {
  startupCleanup: Promise<void>;
  recoverAccessToken(rejectedToken?: string): Promise<string | undefined>;
  signal?: AbortSignal;
}): (rejectedToken?: string) => Promise<string | undefined> {
  return async (rejectedToken?: string) => {
    if (!(await waitForStartupCleanup(startupCleanup, signal))) {
      return undefined;
    }
    return recoverAccessToken(rejectedToken);
  };
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
  createLeaseId = () => globalThis.crypto.randomUUID(),
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
  createLeaseId?: () => string;
}): Promise<string | undefined> {
  let ownedTabId: number | undefined;
  let ownedLeaseKey: string | undefined;
  const deadline = now() + KIMI_RECOVERY_TIMEOUT_MS;

  try {
    if (signal?.aborted) return undefined;

    const createOperation = createTab({ url: KIMI_URL, active: false });
    const createResult = await settleBeforeRecoveryBoundary(
      createOperation,
      deadline,
      signal,
      now,
    );
    if (createResult === RECOVERY_STOPPED) {
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
    const leaseKey = createKimiRecoveryLeaseKey(createLeaseId);
    ownedLeaseKey = leaseKey;

    const leaseWrite = storageSession.set({
      [leaseKey]: {
        tabId: ownedTabId,
        createdAt: now(),
      } satisfies KimiRecoveryLease,
    });
    const leaseResult = await settleBeforeRecoveryBoundary(
      leaseWrite,
      deadline,
      signal,
      now,
    );
    if (leaseResult === RECOVERY_STOPPED) {
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
    if (ownedTabId !== undefined && ownedLeaseKey !== undefined) {
      launchOwnedTabCleanup(
        ownedTabId,
        ownedLeaseKey,
        removeTab,
        storageSession,
      );
    } else if (ownedTabId !== undefined) {
      const tabId = ownedTabId;
      launchBestEffort(() => removeTab(tabId));
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
    const stored = await storageSession.get(null);
    const leaseEntries = Object.entries(stored).filter(
      ([key]) =>
        key === KIMI_RECOVERY_LEASE_KEY ||
        key.startsWith(KIMI_RECOVERY_LEASE_KEY_PREFIX),
    );

    for (const [leaseKey, value] of leaseEntries) {
      try {
        const lease = parseRecoveryLease(value);
        if (!lease) continue;

        const age = now() - lease.createdAt;
        if (age < 0 || age > KIMI_ABANDONED_LEASE_MAX_AGE_MS) continue;

        let tab: KimiTab;
        try {
          tab = await getTab(lease.tabId);
        } catch {
          continue;
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
