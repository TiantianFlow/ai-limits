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

const KIMI_URL = "https://www.kimi.com/";
const KIMI_REFRESH_POLL_ATTEMPTS = 20;
const KIMI_REFRESH_POLL_INTERVAL_MS = 250;
const KIMI_REFRESH_TIMEOUT_MS = 5_000;
const RECOVERY_STOPPED = Symbol("recovery-stopped");

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
  signal?: AbortSignal,
): Promise<BoundedResult<T>> {
  if (signal?.aborted) return Promise.resolve(RECOVERY_STOPPED);

  const remainingMs = deadline - Date.now();
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

export async function refreshKimiAccessTokenInTemporaryTab({
  staleAccessToken,
  createTab,
  readAccessToken,
  removeTab,
  signal,
  wait = delay,
}: {
  staleAccessToken: string;
  createTab(details: {
    url: string;
    active: false;
  }): Promise<{ id?: number }>;
  readAccessToken(tabId: number): Promise<unknown>;
  removeTab(tabId: number): Promise<void>;
  signal?: AbortSignal;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<string | undefined> {
  let temporaryTabId: number | undefined;

  try {
    if (signal?.aborted) return undefined;

    const tab = await createTab({ url: KIMI_URL, active: false });
    if (tab.id === undefined) return undefined;
    temporaryTabId = tab.id;
    const recoveryDeadline = Date.now() + KIMI_REFRESH_TIMEOUT_MS;

    for (let attempt = 0; attempt < KIMI_REFRESH_POLL_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) return undefined;

      const readResult = await settleBeforeRecoveryBoundary(
        readAccessToken(temporaryTabId),
        recoveryDeadline,
        signal,
      );
      if (readResult === RECOVERY_STOPPED) return undefined;
      if (readResult.status === "resolved") {
        const token =
          typeof readResult.value === "string"
            ? readResult.value.trim()
            : undefined;
        if (token && token !== staleAccessToken) {
          return token;
        }
      }

      if (attempt < KIMI_REFRESH_POLL_ATTEMPTS - 1) {
        const remainingMs = recoveryDeadline - Date.now();
        if (remainingMs <= 0) return undefined;
        const waitResult = await settleBeforeRecoveryBoundary(
          wait(Math.min(KIMI_REFRESH_POLL_INTERVAL_MS, remainingMs)),
          recoveryDeadline,
          signal,
        );
        if (waitResult === RECOVERY_STOPPED || waitResult.status === "rejected") {
          return undefined;
        }
      }
    }
  } catch {
    // This is a best-effort session recovery; normal manual recovery remains.
  } finally {
    if (temporaryTabId !== undefined) {
      try {
        await removeTab(temporaryTabId);
      } catch {
        // The user or browser may already have closed the temporary tab.
      }
    }
  }

  return undefined;
}
