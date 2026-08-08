import { refreshProvider, setProviderHealth } from "../background/coordinator";
import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
} from "../background/messages";
import { hasProviderPermission } from "../background/permissions";
import { refreshGrantedProviders } from "../background/refresh";
import {
  providerIds,
  providerRegistry,
  type ConnectableProviderId,
} from "../providers/registry";
import { ensureState, setDisplayMode } from "../storage/repository";

const REFRESH_ALARM = "refresh-connected";
const REFRESH_PERIOD_MINUTES = 15;
const COLLECTION_TIMEOUT_MS = 20_000;

async function ensureRefreshAlarm(): Promise<void> {
  const current = await browser.alarms.get(REFRESH_ALARM);
  if (current?.periodInMinutes === REFRESH_PERIOD_MINUTES) {
    return;
  }

  await browser.alarms.create(REFRESH_ALARM, {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
  });
}

async function collectProvider(providerId: ConnectableProviderId): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    COLLECTION_TIMEOUT_MS,
  );

  try {
    const adapter = providerRegistry[providerId];
    await refreshProvider(adapter, {
      fetch: globalThis.fetch.bind(globalThis),
      now: Date.now(),
      signal: controller.signal,
      ...(providerId === "kimi"
        ? {
            getCookie: (details: { url: string; name: string }) =>
              browser.cookies.get(details),
          }
        : {}),
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function refreshConnectedProviders(): Promise<void> {
  await refreshGrantedProviders(
    providerIds,
    hasProviderPermission,
    collectProvider,
  );
}

async function currentState() {
  return ensureState(Date.now());
}

const handleRuntimeCommand = createRuntimeCommandHandler({
  async refreshAll() {
    await refreshConnectedProviders();
    return currentState();
  },
  async collectProvider(providerId) {
    const granted = await hasProviderPermission(providerId);
    if (!granted) {
      await setProviderHealth(
        providerId,
        { kind: "permission_required" },
        Date.now(),
      );
      return currentState();
    }

    await setProviderHealth(providerId, { kind: "connecting" }, Date.now());
    await collectProvider(providerId);
    return currentState();
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

export default defineBackground(() => {
  void ensureRefreshAlarm();

  browser.runtime.onInstalled.addListener(() => {
    void Promise.all([ensureState(Date.now()), ensureRefreshAlarm()]);
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

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      void refreshConnectedProviders();
    }
  });
});
