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
// Kimi's own boot watchdog is 30s. Document-complete is earlier than client
// mount, and an expired session is replaced only after that mount.
export const KIMI_RECOVERY_TIMEOUT_MS = 30_000;
// Hold the first acceptable token so a pre-refresh value cannot close the tab.
// A later different token is the completed refresh and is returned immediately.
export const KIMI_TOKEN_STABLE_MS = 10_000;
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

  let candidate: string | undefined;
  let candidateSince = 0;
  let failed = false;

  try {
    while (!signal?.aborted && now() < deadline) {
      const readResult = await settleBeforeBoundary(
        readAccessToken(owned.tabId),
        deadline,
        signal,
        now,
      );
      if (readResult === OWNED_TAB_STOPPED) break;

      const token =
        readResult.status === "resolved" &&
        typeof readResult.value === "string"
          ? readResult.value.trim()
          : "";
      const acceptable =
        token.length > 0 &&
        (rejectedToken === undefined || token !== rejectedToken);
      if (!acceptable) {
        // A navigation or a still-rejected token means the page has not
        // finished refreshing. Drop the candidate so the tab stays open.
        candidate = undefined;
      } else if (candidate !== undefined && token !== candidate) {
        return token;
      } else if (candidate !== token) {
        candidate = token;
        candidateSince = now();
      } else if (now() - candidateSince >= KIMI_TOKEN_STABLE_MS) {
        return token;
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0) break;
      const waitResult = await settleBeforeBoundary(
        wait(Math.min(KIMI_RECOVERY_POLL_INTERVAL_MS, remainingMs)),
        deadline,
        signal,
        now,
      );
      if (waitResult === OWNED_TAB_STOPPED) break;
      if (waitResult.status === "rejected") return undefined;
    }
  } catch {
    // Recovery is bounded best-effort work and never exposes browser errors.
    failed = true;
  } finally {
    releaseOwnedBackgroundTab({
      tabId: owned.tabId,
      leaseKey: owned.leaseKey,
      removeTab,
      storageSession,
    });
  }

  if (failed || signal?.aborted) return undefined;
  return candidate;
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
