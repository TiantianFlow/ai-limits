import {
  refreshProvider as collectAndCommitProvider,
  reconcileRemovedProviderPermissions,
  reconcileProviderPermissions,
} from "../background/coordinator";
import type { ProviderRefreshOutcome } from "../domain/model";
import {
  findKimiPageAccessToken,
  refreshKimiAccessTokenInTemporaryTab,
} from "../background/kimi-session";
import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
} from "../background/messages";
import {
  createRefreshOrchestrator,
  type RefreshPolicy,
} from "../background/orchestrator";
import { hasProviderPermission } from "../background/permissions";
import {
  providerIds,
  providerRegistry,
  type ConnectableProviderId,
} from "../providers/registry";
import { ensureState, setDisplayMode } from "../storage/repository";

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

async function collectProvider(
  providerId: ConnectableProviderId,
  policy: RefreshPolicy,
  shouldCommit: () => boolean,
): Promise<ProviderRefreshOutcome> {
  const controller = new AbortController();
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
              getAccessToken: () =>
                findKimiPageAccessToken({
                  queryTabs: () =>
                    browser.tabs.query({ url: "https://www.kimi.com/*" }),
                  readAccessToken: readKimiPageAccessToken,
                }),
              ...(policy.interaction === "allowed"
                ? {
                    getRefreshedAccessToken: (staleAccessToken: string) =>
                      refreshKimiAccessTokenInTemporaryTab({
                        staleAccessToken,
                        createTab: (details) => browser.tabs.create(details),
                        readAccessToken: readKimiPageAccessToken,
                        removeTab: (tabId) => browser.tabs.remove(tabId),
                        signal: controller.signal,
                      }),
                  }
                : {}),
            }
          : {}),
      },
      policy.trigger,
      shouldCommit,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function currentState() {
  await reconcileProviderPermissions(providerIds);
  return ensureState(Date.now());
}

export default defineBackground(() => {
  const refreshOrchestrator = createRefreshOrchestrator({
    providerIds,
    hasPermission: hasProviderPermission,
    runProvider: (providerId, policy, control) =>
      collectProvider(providerId, policy, control.isCurrentGeneration),
  });
  const handleRuntimeCommand = createRuntimeCommandHandler({
    async refreshAll() {
      await reconcileProviderPermissions(providerIds);
      const report = await refreshOrchestrator.refreshAll("manual_all");
      return { state: await currentState(), report };
    },
    async collectProvider(providerId) {
      await reconcileProviderPermissions(providerIds);
      const report = await refreshOrchestrator.refreshProvider(
        providerId,
        "connect",
      );
      return { state: await currentState(), report };
    },
    async refreshProvider(providerId) {
      await reconcileProviderPermissions(providerIds);
      const report = await refreshOrchestrator.refreshProvider(
        providerId,
        "manual_provider",
      );
      return { state: await currentState(), report };
    },
    getState: currentState,
    async setDisplayMode(mode) {
      await setDisplayMode(mode);
      return currentState();
    },
  });
  const handleRuntimeMessage = createChromeRuntimeMessageListener(
    handleRuntimeCommand,
  );

  void ensureRefreshAlarm();

  browser.runtime.onInstalled.addListener(() => {
    void Promise.all([currentState(), ensureRefreshAlarm()]);
  });

  browser.runtime.onStartup.addListener(() => {
    void ensureRefreshAlarm();
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) {
      void browser.sidePanel.open({ windowId: tab.windowId });
    }
  });

  browser.runtime.onMessage.addListener(handleRuntimeMessage);

  browser.permissions.onAdded.addListener(() => {
    void reconcileProviderPermissions(providerIds);
  });

  browser.permissions.onRemoved.addListener((permissions) => {
    void reconcileRemovedProviderPermissions(permissions, providerIds);
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      void reconcileProviderPermissions(providerIds).then(() =>
        refreshOrchestrator.refreshAll("scheduled"),
      );
    }
  });
});
