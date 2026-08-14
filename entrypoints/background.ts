import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
} from "../background/messages";
import { updateAutoRefreshTransaction } from "../background/auto-refresh";
import {
  createProviderService,
  type ProviderService,
} from "../background/provider-service";
import { launchScheduledRefresh } from "../background/scheduled-refresh";
import { projectAppViewState } from "../background/view-state";
import type { InstanceAppState } from "../domain/instances";
import { providerRegistry } from "../providers/registry";
import type { ProviderPackage } from "../providers/types";
import { initializeCredentialVault } from "../storage/credential-vault";
import { migrateLegacyStorageInPlace } from "../storage/migration";

const REFRESH_ALARM = "refresh-connected";
const REFRESH_PERIOD_MINUTES = 15;

async function ensureRefreshAlarm(): Promise<void> {
  const current = await browser.alarms.get(REFRESH_ALARM);
  if (current?.periodInMinutes === REFRESH_PERIOD_MINUTES) return;
  await browser.alarms.create(REFRESH_ALARM, {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
  });
}

async function syncRefreshAlarm(state: InstanceAppState): Promise<void> {
  const shouldRefresh =
    state.preferences.autoRefresh &&
    state.instances.some((instance) => instance.access === "granted");
  if (!shouldRefresh) {
    await browser.alarms.clear(REFRESH_ALARM);
    return;
  }
  await ensureRefreshAlarm();
}

type StartupPackage = Pick<ProviderPackage, "startup">;

export interface BackgroundInitializationOptions {
  initializeVault(): Promise<void>;
  grantedPermissions(): Promise<Browser.permissions.Permissions>;
  migrate(
    now: number,
    granted: Browser.permissions.Permissions,
  ): Promise<unknown>;
  packages: readonly StartupPackage[];
  createService(): ProviderService;
  now(): number;
}

const productionOptions: BackgroundInitializationOptions = {
  initializeVault: initializeCredentialVault,
  grantedPermissions: () => browser.permissions.getAll(),
  migrate: migrateLegacyStorageInPlace,
  packages: Object.values(providerRegistry),
  createService: createProviderService,
  now: Date.now,
};

async function settlePackageStartup(
  packages: readonly StartupPackage[],
): Promise<void> {
  await Promise.all(
    packages.map(async (providerPackage) => {
      try {
        await providerPackage.startup?.();
      } catch {
        // A package hook must settle before activation but cannot expose its
        // cleanup error through an unhandled service-worker rejection.
      }
    }),
  );
}

export async function initializeBackground(
  options: BackgroundInitializationOptions = productionOptions,
): Promise<void> {
  await options.initializeVault();
  const granted = await options.grantedPermissions();
  await options.migrate(options.now(), granted);
  await settlePackageStartup(options.packages);

  const service = options.createService();
  await service.reconcilePermissions();
  await syncRefreshAlarm(await service.getState());

  const currentView = async () => projectAppViewState(await service.getState());
  const commandHandler = createRuntimeCommandHandler({
    async refreshAll() {
      const report = await service.refreshAll("manual_all");
      const state = await service.getState();
      await syncRefreshAlarm(state);
      return { state: projectAppViewState(state), report };
    },
    async connectBrowserProvider(providerKind) {
      const report = await service.connectBrowserProvider(providerKind);
      const state = await service.getState();
      await syncRefreshAlarm(state);
      return { state: projectAppViewState(state), report };
    },
    async connectApiKeyProvider(command) {
      const { type: _type, ...request } = command;
      const result = await service.connectApiKeyProvider(request);
      const state = await service.getState();
      await syncRefreshAlarm(state);
      return { ...result, state: projectAppViewState(state) };
    },
    async refreshInstance(instanceId) {
      const report = await service.refreshInstance(
        instanceId,
        "manual_provider",
      );
      const state = await service.getState();
      await syncRefreshAlarm(state);
      return { state: projectAppViewState(state), report };
    },
    async renameInstance(instanceId, userLabel) {
      await service.renameInstance(instanceId, userLabel);
      return currentView();
    },
    async disconnectInstance(instanceId) {
      const result = await service.disconnectInstance(instanceId);
      const state = await service.getState();
      await syncRefreshAlarm(state);
      return { state: projectAppViewState(state), result };
    },
    getState: currentView,
    async setDisplayMode(mode) {
      await service.setDisplayMode(mode);
      return currentView();
    },
    async setAutoRefresh(enabled) {
      const state = await updateAutoRefreshTransaction(enabled, {
        readState: () => service.getState(),
        writePreference: (value) => service.setAutoRefresh(value),
        syncAlarm: syncRefreshAlarm,
      });
      return projectAppViewState(state);
    },
    async deleteLocalData() {
      const result = await service.deleteAllLocalData();
      const state = await service.getState();
      await syncRefreshAlarm(state);
      return { state: projectAppViewState(state), ...result };
    },
  });

  browser.runtime.onMessage.addListener(
    createChromeRuntimeMessageListener(commandHandler),
  );
  browser.permissions.onAdded.addListener(() => {
    void service
      .reconcilePermissions()
      .then(() => service.getState())
      .then(syncRefreshAlarm)
      .catch(() => undefined);
  });
  browser.permissions.onRemoved.addListener((removed) => {
    void service
      .reconcilePermissions(removed)
      .then(() => service.getState())
      .then(syncRefreshAlarm)
      .catch(() => undefined);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REFRESH_ALARM) return;
    launchScheduledRefresh({
      refreshAll: (trigger) => service.refreshAll(trigger),
      currentState: () => service.getState(),
      syncRefreshAlarm,
    });
  });
}

export default defineBackground(() => {
  void initializeBackground().catch(() => undefined);
});
