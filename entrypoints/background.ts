import {
  disconnectProvider as disconnectAndCleanupProvider,
  refreshProvider as collectAndCommitProvider,
  reconcileRemovedProviderPermissions,
  reconcileProviderPermissions,
} from "../background/coordinator";
import { updateAutoRefreshTransaction } from "../background/auto-refresh";
import type { ProviderRefreshOutcome } from "../domain/model";
import {
  cleanupAbandonedKimiRecoveryTab,
  createKimiRecoveryAfterStartupCleanup,
  findKimiPageAccessToken,
  refreshKimiAccessTokenInTemporaryTab,
} from "../background/kimi-session";
import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
  type ProviderOperationEvent,
} from "../background/messages";
import {
  createRefreshOrchestrator,
  type RefreshPolicy,
} from "../background/orchestrator";
import {
  hasProviderPermission,
  removeAllProviderPermissions,
} from "../background/permissions";
import {
  providerIds,
  providerRegistry,
  type ConnectableProviderId,
} from "../providers/registry";
import {
  deleteAllLocalData,
  ensureState,
  setAutoRefresh as persistAutoRefresh,
  setDisplayMode,
} from "../storage/repository";

const REFRESH_ALARM = "refresh-connected";
const REFRESH_PERIOD_MINUTES = 15;

async function readKimiPageAccessToken(tabId: number): Promise<unknown> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => globalThis.localStorage.getItem("access_token"),
  });
  return injection?.result;
}

async function ensureRefreshAlarm(): Promise<void> {
  const current = await browser.alarms.get(REFRESH_ALARM);
  if (current?.periodInMinutes === REFRESH_PERIOD_MINUTES) {
    return;
  }

  await browser.alarms.create(REFRESH_ALARM, {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
  });
}

async function syncRefreshAlarm(
  state: Awaited<ReturnType<typeof currentState>>,
): Promise<void> {
  const shouldRefresh =
    state.preferences.autoRefresh &&
    state.providers.some((provider) => provider.access === "granted");

  if (!shouldRefresh) {
    await browser.alarms.clear(REFRESH_ALARM);
    return;
  }

  await ensureRefreshAlarm();
}

function announceKimiRecovery(): void {
  void browser.runtime
    .sendMessage({
      type: "PROVIDER_OPERATION",
      providerId: "kimi",
      operation: "waiting_for_session",
    } satisfies ProviderOperationEvent)
    .catch(() => undefined);
}

async function collectProvider(
  providerId: ConnectableProviderId,
  policy: RefreshPolicy,
  shouldCommit: () => boolean,
  kimiStartupCleanup: Promise<void>,
  invalidationSignal: AbortSignal,
): Promise<ProviderRefreshOutcome> {
  const controller = new AbortController();
  const abortInvalidatedRun = () => controller.abort();
  if (invalidationSignal.aborted) {
    controller.abort();
  } else {
    invalidationSignal.addEventListener("abort", abortInvalidatedRun, {
      once: true,
    });
  }
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    policy.deadlineMs,
  );

  try {
    const adapter = providerRegistry[providerId];
    return await collectAndCommitProvider(
      adapter,
      {
        fetch: globalThis.fetch.bind(globalThis),
        now: Date.now(),
        signal: controller.signal,
        ...(providerId === "kimi"
          ? {
              getCookie: (details: { url: string; name: string }) =>
                browser.cookies.get(details),
              interaction: policy.interaction,
              kimiSessionResolver: {
                findAvailableAccessToken: () =>
                  findKimiPageAccessToken({
                    queryTabs: () =>
                      browser.tabs.query({ url: "https://www.kimi.com/*" }),
                    readAccessToken: readKimiPageAccessToken,
                  }),
                recoverAccessToken: createKimiRecoveryAfterStartupCleanup({
                  startupCleanup: kimiStartupCleanup,
                  signal: controller.signal,
                  recoverAccessToken: (rejectedToken?: string) => {
                    announceKimiRecovery();
                    return refreshKimiAccessTokenInTemporaryTab({
                      rejectedToken,
                      createTab: (details) => browser.tabs.create(details),
                      getTab: (tabId) => browser.tabs.get(tabId),
                      readAccessToken: readKimiPageAccessToken,
                      removeTab: (tabId) => browser.tabs.remove(tabId),
                      addUpdatedListener: (listener) => {
                        browser.tabs.onUpdated.addListener(listener);
                        return () =>
                          browser.tabs.onUpdated.removeListener(listener);
                      },
                      addRemovedListener: (listener) => {
                        browser.tabs.onRemoved.addListener(listener);
                        return () =>
                          browser.tabs.onRemoved.removeListener(listener);
                      },
                      storageSession: browser.storage.session,
                      signal: controller.signal,
                    });
                  },
                }),
              },
            }
          : {}),
      },
      policy.trigger,
      shouldCommit,
    );
  } finally {
    invalidationSignal.removeEventListener("abort", abortInvalidatedRun);
    globalThis.clearTimeout(timeout);
  }
}

async function currentState() {
  await reconcileProviderPermissions(providerIds);
  return ensureState(Date.now());
}

export default defineBackground(() => {
  const kimiStartupCleanup = cleanupAbandonedKimiRecoveryTab({
    storageSession: browser.storage.session,
    getTab: (tabId) => browser.tabs.get(tabId),
    removeTab: (tabId) => browser.tabs.remove(tabId),
  });
  const refreshOrchestrator = createRefreshOrchestrator({
    providerIds,
    isAutoRefreshEnabled: async () =>
      (await ensureState(Date.now())).preferences.autoRefresh,
    hasPermission: hasProviderPermission,
    runProvider: (providerId, policy, control) =>
      collectProvider(
        providerId,
        policy,
        control.isCurrentGeneration,
        kimiStartupCleanup,
        control.signal,
      ),
  });
  const handleRuntimeCommand = createRuntimeCommandHandler({
    async refreshAll() {
      const report = await refreshOrchestrator.refreshAll("manual_all");
      const state = await currentState();
      await syncRefreshAlarm(state);
      return { state, report };
    },
    async collectProvider(providerId) {
      const report = await refreshOrchestrator.refreshProvider(
        providerId,
        "connect",
      );
      const state = await currentState();
      await syncRefreshAlarm(state);
      return { state, report };
    },
    async refreshProvider(providerId) {
      const report = await refreshOrchestrator.refreshProvider(
        providerId,
        "manual_provider",
      );
      const state = await currentState();
      await syncRefreshAlarm(state);
      return { state, report };
    },
    async getState() {
      const state = await currentState();
      await syncRefreshAlarm(state);
      return state;
    },
    async setDisplayMode(mode) {
      await setDisplayMode(mode);
      return currentState();
    },
    async setAutoRefresh(enabled) {
      return updateAutoRefreshTransaction(enabled, {
        readState: currentState,
        writePreference: persistAutoRefresh,
        syncAlarm: syncRefreshAlarm,
      });
    },
    async disconnectProvider(providerId) {
      refreshOrchestrator.invalidateProvider(providerId);
      const before = await currentState();
      const connected = before.providers
        .filter((provider) => provider.access === "granted")
        .map((provider) => provider.providerId);
      const result = await disconnectAndCleanupProvider(providerId, connected);
      if (!result.ok) {
        throw new Error("permission_removal_failed");
      }

      const state = await currentState();
      await syncRefreshAlarm(state);
      return state;
    },
    async deleteLocalData() {
      refreshOrchestrator.invalidateAll();
      await browser.alarms.clear(REFRESH_ALARM);
      const fullyRevoked = await removeAllProviderPermissions(providerIds);
      let state = await deleteAllLocalData();
      if (!fullyRevoked) {
        await persistAutoRefresh(false);
        state = await currentState();
      }

      await syncRefreshAlarm(state);
      return {
        state,
        result: fullyRevoked
          ? "deleted"
          : "deleted_with_permission_errors",
      };
    },
  });
  const handleRuntimeMessage = createChromeRuntimeMessageListener(
    handleRuntimeCommand,
  );

  void currentState().then(syncRefreshAlarm);

  browser.runtime.onInstalled.addListener(() => {
    void currentState().then(syncRefreshAlarm);
  });

  browser.runtime.onStartup.addListener(() => {
    void currentState().then(syncRefreshAlarm);
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) {
      void browser.sidePanel.open({ windowId: tab.windowId });
    }
  });

  browser.runtime.onMessage.addListener(handleRuntimeMessage);

  browser.permissions.onAdded.addListener(() => {
    void reconcileProviderPermissions(providerIds)
      .then(currentState)
      .then(syncRefreshAlarm);
  });

  browser.permissions.onRemoved.addListener((permissions) => {
    void reconcileRemovedProviderPermissions(permissions, providerIds)
      .then(currentState)
      .then(syncRefreshAlarm);
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      void refreshOrchestrator.refreshAll("scheduled");
    }
  });

});
