import { refreshProvider, setProviderHealth } from "../background/coordinator";
import { createRuntimeCommandHandler } from "../background/messages";
import {
  hasProviderPermission,
  requestProviderPermission,
} from "../background/permissions";
import { chatGptAdapter } from "../providers/chatgpt/adapter";
import { ensureState, loadState } from "../storage/repository";

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

async function collectChatGpt(): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    COLLECTION_TIMEOUT_MS,
  );

  try {
    await refreshProvider(chatGptAdapter, {
      fetch: globalThis.fetch.bind(globalThis),
      now: Date.now(),
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function refreshConnectedProviders(): Promise<void> {
  if (await hasProviderPermission("chatgpt")) {
    await collectChatGpt();
  }
}

async function currentState() {
  return (await loadState()) ?? ensureState(Date.now());
}

const handleRuntimeCommand = createRuntimeCommandHandler({
  async refreshAll() {
    await refreshConnectedProviders();
    return currentState();
  },
  async connectProvider(providerId) {
    const granted = await requestProviderPermission(providerId);
    if (!granted) {
      await setProviderHealth(
        providerId,
        { kind: "permission_required" },
        Date.now(),
      );
      return currentState();
    }

    await collectChatGpt();
    return currentState();
  },
  getState: currentState,
});

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

  browser.runtime.onMessage.addListener((message) =>
    handleRuntimeCommand(message) as Promise<unknown> | undefined,
  );

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      void refreshConnectedProviders();
    }
  });
});
