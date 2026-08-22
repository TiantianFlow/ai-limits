import {
  cleanupAbandonedOwnedTabs,
  delay,
  openOwnedBackgroundTab,
  OWNED_TAB_STOPPED,
  releaseOwnedBackgroundTab,
  settleBeforeBoundary,
  type ListenerCleanup,
  type ProviderTab,
  type RemovedListener,
  type StorageSessionLike,
  type UpdatedListener,
} from "../tab-ensure";

export const KIMI_RECOVERY_LEASE_KEY = "kimiRecoveryTabLease";

const KIMI_URL = "https://www.kimi.com/";
const KIMI_RECOVERY_TIMEOUT_MS = 10_000;
const KIMI_RECOVERY_POLL_INTERVAL_MS = 250;
const KIMI_ABANDONED_LEASE_MAX_AGE_MS = 60_000;


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
      () => finish(false),
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
  createTab(details: { url: string; active: false }): Promise<ProviderTab>;
  getTab(tabId: number): Promise<ProviderTab>;
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
  const deadline = now() + KIMI_RECOVERY_TIMEOUT_MS;
  const owned = await openOwnedBackgroundTab({
    url: KIMI_URL,
    leaseKeyPrefix: KIMI_RECOVERY_LEASE_KEY,
    deadline,
    createTab,
    getTab,
    removeTab,
    addUpdatedListener,
    addRemovedListener,
    storageSession,
    signal,
    now,
    createLeaseId,
  });
  if (!owned) return undefined;

  try {
    while (!signal?.aborted && now() < deadline) {
      const readResult = await settleBeforeBoundary(
        readAccessToken(owned.tabId),
        deadline,
        signal,
        now,
      );
      if (readResult === OWNED_TAB_STOPPED || readResult.status === "rejected") {
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
      const waitResult = await settleBeforeBoundary(
        wait(Math.min(KIMI_RECOVERY_POLL_INTERVAL_MS, remainingMs)),
        deadline,
        signal,
        now,
      );
      if (waitResult === OWNED_TAB_STOPPED || waitResult.status === "rejected") {
        return undefined;
      }
    }
  } catch {
    // Recovery is bounded best-effort work and never exposes browser errors.
  } finally {
    releaseOwnedBackgroundTab({
      tabId: owned.tabId,
      leaseKey: owned.leaseKey,
      removeTab,
      storageSession,
    });
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
  getTab(tabId: number): Promise<ProviderTab>;
  removeTab(tabId: number): Promise<void>;
  now?: () => number;
}): Promise<void> {
  return cleanupAbandonedOwnedTabs({
    storageSession,
    getTab,
    removeTab,
    now,
    leaseKeyPrefix: KIMI_RECOVERY_LEASE_KEY,
    maxAgeMs: KIMI_ABANDONED_LEASE_MAX_AGE_MS,
    remainsOnOwnedUrl: (url) =>
      url === KIMI_URL || url?.startsWith(KIMI_URL) === true,
  });
}
