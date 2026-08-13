import {
  disconnectProvider as disconnectAndCleanupProvider,
  refreshProvider as collectAndCommitProvider,
  reconcileRemovedProviderPermissions,
  reconcileProviderPermissions,
} from "../background/coordinator";
import { updateAutoRefreshTransaction } from "../background/auto-refresh";
import type { AppState, ProviderRefreshOutcome } from "../domain/model";
import {
  cleanupAbandonedKimiRecoveryTab,
  createKimiRecoveryAfterStartupCleanup,
  findKimiPageAccessToken,
  refreshKimiAccessTokenInTemporaryTab,
} from "../background/kimi-session";
import { readKimiPageAccessToken } from "../background/kimi-page";
import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
  type ProviderOperationEvent,
} from "../background/messages";
import {
  createApiKeyConnectionLifecycle,
  markStoredApiKeyRejectedForOutcome,
} from "../background/api-key-connection";
import {
  createRefreshOrchestrator,
  type RefreshPolicy,
} from "../background/orchestrator";
import {
  createProviderOperationLane,
  type ProviderCleanupToken,
} from "../background/provider-operation-lane";
import { launchScheduledRefresh } from "../background/scheduled-refresh";
import {
  hasProviderPermission,
  removeAllProviderPermissions,
} from "../background/permissions";
import { isProviderRefreshEligible } from "../background/provider-access";
import {
  isApiKeyProviderId,
  providerCatalog,
  type ApiKeyProviderId,
} from "../providers/catalog";
import {
  providerIds,
  providerRegistry,
  type ConnectableProviderId,
} from "../providers/registry";
import {
  deleteAllLocalData,
  disconnectProviderData,
  ensureState,
  markProviderAccessRequired,
  setAutoRefresh as persistAutoRefresh,
  setDisplayMode,
} from "../storage/repository";
import {
  initializeCredentialStorage,
  readProviderCredentialWithRevision,
} from "../storage/credentials";
import {
  clearProviderConnectionSuppressions,
  isProviderConnectionSuppressed,
  replaceProviderConnectionSuppressions,
  setProviderConnectionSuppressed,
} from "../storage/connection-suppressions";

const REFRESH_ALARM = "refresh-connected";
const REFRESH_PERIOD_MINUTES = 15;

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
  state: AppState,
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

export async function collectProvider(
  providerId: ConnectableProviderId,
  policy: RefreshPolicy,
  shouldCommit: () => boolean,
  kimiStartupCleanup: Promise<void>,
  invalidationSignal: AbortSignal,
): Promise<ProviderRefreshOutcome> {
  const adapter = providerRegistry[providerId];
  const storedCredential = isApiKeyProviderId(providerId)
    ? await readProviderCredentialWithRevision(providerId)
    : undefined;
  const outcome = await collectAndCommitProvider(
    adapter,
    {
      fetch: globalThis.fetch.bind(globalThis),
      now: Date.now(),
      signal: invalidationSignal,
      ...(storedCredential?.status === "active"
        ? {
            credential: {
              kind: "api-key" as const,
              value: storedCredential.value,
            },
          }
        : {}),
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
                  readAccessToken: (tabId) =>
                    readKimiPageAccessToken(tabId, (details) =>
                      browser.scripting.executeScript(details),
                    ),
                }),
              recoverAccessToken: createKimiRecoveryAfterStartupCleanup({
                startupCleanup: kimiStartupCleanup,
                signal: invalidationSignal,
                recoverAccessToken: (rejectedToken?: string) => {
                  announceKimiRecovery();
                  return refreshKimiAccessTokenInTemporaryTab({
                    rejectedToken,
                    createTab: (details) => browser.tabs.create(details),
                    getTab: (tabId) => browser.tabs.get(tabId),
                    readAccessToken: (tabId) =>
                      readKimiPageAccessToken(tabId, (details) =>
                        browser.scripting.executeScript(details),
                      ),
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
                    signal: invalidationSignal,
                  });
                },
              }),
            },
          }
        : {}),
    },
    policy.trigger,
    () => !invalidationSignal.aborted && shouldCommit(),
  );
  if (isApiKeyProviderId(providerId) && storedCredential) {
    await markStoredApiKeyRejectedForOutcome(
      providerId,
      storedCredential.revision,
      outcome,
    );
  }
  return outcome;
}

function providersAffectedByPermissionChange(
  changed: Browser.permissions.Permissions | undefined,
): ConnectableProviderId[] {
  return providerIds.filter((providerId) => {
    const provider = providerCatalog[providerId];
    return (
      provider.optionalOrigins.some((origin) =>
        changed?.origins?.includes(origin),
      ) ||
      provider.optionalPermissions.some((permission) =>
        (changed?.permissions as readonly string[] | undefined)?.includes(
          permission,
        ),
      )
    );
  });
}

async function providerBackoffRetryAt(
  providerId: ConnectableProviderId,
): Promise<number | undefined> {
  const state = await ensureState(Date.now());
  const outcome = state.providers.find(
    (provider) => provider.providerId === providerId,
  )?.lastAttempt?.outcome;
  if (
    !outcome ||
    ((outcome.kind !== "failure" ||
      outcome.category !== "temporary_error") &&
      (outcome.kind !== "deferred" || outcome.reason !== "backoff"))
  ) {
    return undefined;
  }

  return outcome.retryAt;
}

export async function deleteLocalDataWithPermissionCleanup(): Promise<{
  state: Awaited<ReturnType<typeof deleteAllLocalData>>;
  result: "deleted" | "deleted_with_permission_errors";
}> {
  let fullyRevoked = false;
  try {
    fullyRevoked = await removeAllProviderPermissions(providerIds);
  } finally {
    let state = await deleteAllLocalData();
    if (!fullyRevoked) {
      await replaceProviderConnectionSuppressions(providerIds);
      await persistAutoRefresh(false);
      state = await ensureState(Date.now());
    } else {
      await clearProviderConnectionSuppressions(providerIds);
    }

    return {
      state,
      result: fullyRevoked
        ? "deleted"
        : "deleted_with_permission_errors",
    };
  }
}

export default defineBackground(() => {
  const credentialStorageReady = initializeCredentialStorage().then(
    () => true,
    () => false,
  );
  const browserSessionProviderIds = providerIds.filter(
    (providerId) =>
      providerCatalog[providerId].connection.kind === "browser-session",
  );
  const apiKeyProviderIds = providerIds.filter(isApiKeyProviderId);
  const kimiStartupCleanup = cleanupAbandonedKimiRecoveryTab({
    storageSession: browser.storage.session,
    getTab: (tabId) => browser.tabs.get(tabId),
    removeTab: (tabId) => browser.tabs.remove(tabId),
  });
  const providerOperationLane = createProviderOperationLane();
  const apiKeyConnectionLifecycle = createApiKeyConnectionLifecycle();
  interface PermissionConnectIntent {
    accepted: boolean;
    eventObserved: boolean;
    inProgress: boolean;
  }
  const permissionConnectIntents = new Map<
    ApiKeyProviderId,
    PermissionConnectIntent
  >();
  const permissionAudits = new Map<ApiKeyProviderId, Promise<void>>();
  const knownApiKeyPermissionPresence = new Map<ApiKeyProviderId, boolean>();
  const apiKeyPermissionAuthorityGenerations = new Map<
    ApiKeyProviderId,
    number
  >();
  const reserveApiKeyPermissionAuthority = (
    providerId: ApiKeyProviderId,
  ): number => {
    const generation =
      (apiKeyPermissionAuthorityGenerations.get(providerId) ?? 0) + 1;
    apiKeyPermissionAuthorityGenerations.set(providerId, generation);
    return generation;
  };
  const commitApiKeyPermissionAuthority = (
    providerId: ApiKeyProviderId,
    generation: number,
    present: boolean,
  ): boolean => {
    if (apiKeyPermissionAuthorityGenerations.get(providerId) !== generation) {
      return false;
    }
    knownApiKeyPermissionPresence.set(providerId, present);
    return true;
  };
  const replaceApiKeyPermissionAuthority = (
    providerId: ApiKeyProviderId,
    present: boolean,
  ): void => {
    const generation = reserveApiKeyPermissionAuthority(providerId);
    commitApiKeyPermissionAuthority(providerId, generation, present);
  };
  const refreshOrchestrator = createRefreshOrchestrator({
    providerIds,
    isAutoRefreshEnabled: async () =>
      (await ensureState(Date.now())).preferences.autoRefresh,
    isProviderRefreshEligible: async (providerId) => {
      if (!providerOperationLane.canRefresh(providerId)) {
        return false;
      }
      if (isApiKeyProviderId(providerId) && !(await credentialStorageReady)) {
        return false;
      }
      return isProviderRefreshEligible(providerId);
    },
    getBackoffRetryAt: providerBackoffRetryAt,
    runProvider: async (providerId, policy, control) => {
      const operation = providerOperationLane.beginRefresh(providerId);
      if (!operation) {
        return { kind: "skipped", reason: "superseded" };
      }
      if (isApiKeyProviderId(providerId)) {
        apiKeyConnectionLifecycle.invalidateProvider(providerId);
      }

      try {
        return await collectProvider(
          providerId,
          policy,
          () =>
            providerOperationLane.isCurrent(operation) &&
            control.isCurrentGeneration(),
          kimiStartupCleanup,
          control.signal,
        );
      } finally {
        providerOperationLane.finish(operation);
      }
    },
  });
  type OwnedApiKeyCleanup = {
    providerId: (typeof apiKeyProviderIds)[number];
    token: ProviderCleanupToken;
  };
  const beginApiKeyProviderCleanups = (
    candidates: readonly (typeof apiKeyProviderIds)[number][],
  ): OwnedApiKeyCleanup[] =>
    candidates.map((providerId) => {
      const token = providerOperationLane.beginCleanup(providerId);
      refreshOrchestrator.invalidateProvider(providerId);
      apiKeyConnectionLifecycle.invalidateProvider(providerId);
      return { providerId, token };
    });
  const completeApiKeyProviderCleanups = async (
    cleanups: readonly OwnedApiKeyCleanup[],
  ): Promise<void> => {
    await Promise.all(
      cleanups.map(async ({ providerId, token }) => {
        try {
          await disconnectProviderData(providerId);
        } finally {
          providerOperationLane.endCleanup(token);
        }
      }),
    );
  };
  const finalizeDisconnectedApiKeyProviders = async (
    candidates: readonly (typeof apiKeyProviderIds)[number][] =
      apiKeyProviderIds,
  ): Promise<Map<ApiKeyProviderId, boolean>> => {
    const authority = await Promise.all(
      candidates.map(async (providerId) => {
        const [suppressionAuthority, permissionAuthority] =
          await Promise.allSettled([
            isProviderConnectionSuppressed(providerId),
            hasProviderPermission(providerId),
          ]);
        const suppressed =
          suppressionAuthority.status === "fulfilled"
            ? suppressionAuthority.value
            : undefined;
        const permissionPresent =
          permissionAuthority.status === "fulfilled"
            ? permissionAuthority.value
            : undefined;
        return {
          providerId,
          permissionPresent: permissionPresent === true,
          preserveData: suppressed === false && permissionPresent === true,
        };
      }),
    );
    const cleanups = beginApiKeyProviderCleanups(
      authority
        .filter(({ preserveData }) => !preserveData)
        .map(({ providerId }) => providerId),
    );
    await completeApiKeyProviderCleanups(cleanups);
    return new Map(
      authority.map(({ providerId, permissionPresent }) => [
        providerId,
        permissionPresent,
      ]),
    );
  };
  const credentialAwareCurrentState = async () => {
    const credentialStorageAvailable = await credentialStorageReady;
    const authorityReservations = new Map(
      apiKeyProviderIds.map((providerId) => [
        providerId,
        reserveApiKeyPermissionAuthority(providerId),
      ]),
    );
    const apiKeyPermissionAuthority =
      await finalizeDisconnectedApiKeyProviders();
    await reconcileProviderPermissions(
      credentialStorageAvailable ? providerIds : browserSessionProviderIds,
    );
    apiKeyPermissionAuthority.forEach((present, providerId) => {
      commitApiKeyPermissionAuthority(
        providerId,
        authorityReservations.get(providerId)!,
        present,
      );
    });
    if (!credentialStorageAvailable) {
      await markProviderAccessRequired(apiKeyProviderIds);
    }
    return ensureState(Date.now());
  };
  const handleRuntimeCommand = createRuntimeCommandHandler({
    async refreshAll() {
      const report = await refreshOrchestrator.refreshAll("manual_all");
      const state = await credentialAwareCurrentState();
      await syncRefreshAlarm(state);
      return { state, report };
    },
    async connectApiKeyProvider(providerId, apiKey, connectionIntent) {
      let permissionIntent: PermissionConnectIntent | undefined;
      let pendingPermissionAudit: Promise<void> | undefined;
      if (connectionIntent === "permission-grant") {
        pendingPermissionAudit = permissionAudits.get(providerId);
        permissionAudits.delete(providerId);
        permissionIntent = {
          accepted: false,
          eventObserved: pendingPermissionAudit !== undefined,
          inProgress: true,
        };
        permissionConnectIntents.set(providerId, permissionIntent);
      }

      let operation:
        | ReturnType<typeof providerOperationLane.beginConnect>
        | undefined = undefined;
      try {
        if (pendingPermissionAudit) {
          await pendingPermissionAudit.catch(() => undefined);
        }
        operation = providerOperationLane.beginConnect(providerId);
        if (!operation) throw new Error("provider_cleanup_in_progress");
        refreshOrchestrator.invalidateProvider(providerId);
        if (!(await credentialStorageReady)) {
          throw new Error("credential_storage_unavailable");
        }
        const suppressed = await isProviderConnectionSuppressed(providerId);
        const storedCredential = await readProviderCredentialWithRevision(
          providerId,
        );
        const providerState = (await ensureState(Date.now())).providers.find(
          (provider) => provider.providerId === providerId,
        );
        const permissionWasKnownPresent =
          knownApiKeyPermissionPresence.get(providerId);
        const permissionPresent = await hasProviderPermission(providerId);
        if (!providerOperationLane.isCurrent(operation)) {
          throw new Error("provider_cleanup_in_progress");
        }
        const hasEstablishedConnection =
          permissionPresent &&
          permissionWasKnownPresent !== false &&
          !permissionIntent?.eventObserved &&
          !suppressed &&
          storedCredential !== undefined &&
          providerState?.access === "granted";
        const intentMatchesAuthority =
          connectionIntent === "replacement"
            ? hasEstablishedConnection
            : !hasEstablishedConnection;
        const shouldPurgeDisconnectedData =
          !hasEstablishedConnection &&
          (connectionIntent === "permission-grant" ||
            storedCredential !== undefined ||
            suppressed ||
            providerState?.access === "granted");
        if (shouldPurgeDisconnectedData) {
          await disconnectProviderData(providerId);
          if (!providerOperationLane.isCurrent(operation)) {
            throw new Error("provider_cleanup_in_progress");
          }
        }
        if (!intentMatchesAuthority || !permissionPresent) {
          throw new Error("api_key_connection_intent_mismatch");
        }
        if (permissionIntent) {
          permissionIntent.accepted = true;
        }
        replaceApiKeyPermissionAuthority(providerId, permissionPresent);
        const suppressionCleared = setProviderConnectionSuppressed(
          providerId,
          false,
        );
        await suppressionCleared;
        if (!providerOperationLane.isCurrent(operation)) {
          throw new Error("provider_cleanup_in_progress");
        }
        const admittedOperation = operation;
        const result = await apiKeyConnectionLifecycle.connect(
          providerId,
          apiKey,
          {
            fetch: globalThis.fetch.bind(globalThis),
            now: Date.now(),
          },
          Date.now,
          () => providerOperationLane.isCurrent(admittedOperation),
        );
        const state = await credentialAwareCurrentState();
        await syncRefreshAlarm(state);
        return { ...result, state };
      } finally {
        if (operation) {
          providerOperationLane.finish(operation);
        }
        if (permissionIntent) {
          permissionIntent.inProgress = false;
          const requiresDeferredAudit =
            permissionIntent.eventObserved && !permissionIntent.accepted;
          if (
            (permissionIntent.eventObserved || !permissionIntent.accepted) &&
            permissionConnectIntents.get(providerId) === permissionIntent
          ) {
            permissionConnectIntents.delete(providerId);
          }
          if (requiresDeferredAudit) {
            const cleanups = beginApiKeyProviderCleanups([providerId]);
            await credentialStorageReady;
            await completeApiKeyProviderCleanups(cleanups);
          }
        }
      }
    },
    async collectProvider(providerId) {
      const admission = providerOperationLane.beginConnect(providerId);
      if (!admission) {
        throw new Error("provider_cleanup_in_progress");
      }
      try {
        await setProviderConnectionSuppressed(providerId, false);
        if (!providerOperationLane.isCurrent(admission)) {
          throw new Error("provider_cleanup_in_progress");
        }
      } finally {
        providerOperationLane.finish(admission);
      }
      const report = await refreshOrchestrator.refreshProvider(
        providerId,
        "connect",
      );
      const state = await credentialAwareCurrentState();
      await syncRefreshAlarm(state);
      return { state, report };
    },
    async refreshProvider(providerId) {
      const report = await refreshOrchestrator.refreshProvider(
        providerId,
        "manual_provider",
      );
      const state = await credentialAwareCurrentState();
      await syncRefreshAlarm(state);
      return { state, report };
    },
    async getState() {
      const state = await credentialAwareCurrentState();
      await syncRefreshAlarm(state);
      return state;
    },
    async setDisplayMode(mode) {
      await setDisplayMode(mode);
      return credentialAwareCurrentState();
    },
    async setAutoRefresh(enabled) {
      return updateAutoRefreshTransaction(enabled, {
        readState: credentialAwareCurrentState,
        writePreference: persistAutoRefresh,
        syncAlarm: syncRefreshAlarm,
      });
    },
    async disconnectProvider(providerId) {
      if (isApiKeyProviderId(providerId)) {
        permissionConnectIntents.delete(providerId);
        permissionAudits.delete(providerId);
      }
      const cleanup = providerOperationLane.beginCleanup(providerId);
      refreshOrchestrator.invalidateProvider(providerId);
      if (isApiKeyProviderId(providerId)) {
        apiKeyConnectionLifecycle.invalidateProvider(providerId);
      }
      const suppressionEstablished = setProviderConnectionSuppressed(
        providerId,
        true,
      );
      const suppressionPersisted = suppressionEstablished.then(
        () => true,
        () => false,
      );
      try {
        await disconnectProviderData(providerId);
        const hasDurableSuppression = await suppressionPersisted;
        const before = await credentialAwareCurrentState();
        const connected = before.providers
          .filter((provider) => provider.access === "granted")
          .map((provider) => provider.providerId);
        const result = await disconnectAndCleanupProvider(
          providerId,
          connected,
        );
        if (result.ok && hasDurableSuppression) {
          await setProviderConnectionSuppressed(
            providerId,
            false,
          ).catch(() => undefined);
        }
        const state = await credentialAwareCurrentState();
        await syncRefreshAlarm(state);
        return { state, result };
      } finally {
        providerOperationLane.endCleanup(cleanup);
      }
    },
    async deleteLocalData() {
      permissionConnectIntents.clear();
      permissionAudits.clear();
      const cleanups = providerIds.map((providerId) =>
        providerOperationLane.beginCleanup(providerId),
      );
      refreshOrchestrator.invalidateAll();
      apiKeyConnectionLifecycle.invalidateAll();
      const suppressionsEstablished =
        replaceProviderConnectionSuppressions(providerIds);
      try {
        await suppressionsEstablished;
        await browser.alarms.clear(REFRESH_ALARM);
        const result = await deleteLocalDataWithPermissionCleanup();
        await syncRefreshAlarm(result.state);
        return result;
      } finally {
        cleanups.forEach((cleanup) =>
          providerOperationLane.endCleanup(cleanup),
        );
      }
    },
  });
  const handleRuntimeMessage = createChromeRuntimeMessageListener(
    handleRuntimeCommand,
  );

  void credentialAwareCurrentState()
    .then(syncRefreshAlarm)
    .catch(() => undefined);

  browser.runtime.onInstalled.addListener(() => {
    void credentialAwareCurrentState()
      .then(syncRefreshAlarm)
      .catch(() => undefined);
  });

  browser.runtime.onStartup.addListener(() => {
    void credentialAwareCurrentState()
      .then(syncRefreshAlarm)
      .catch(() => undefined);
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) {
      void browser.sidePanel.open({ windowId: tab.windowId });
    }
  });

  browser.runtime.onMessage.addListener(handleRuntimeMessage);

  browser.permissions.onAdded.addListener((permissions) => {
    const affectedApiKeyProviderIds = providersAffectedByPermissionChange(
      permissions,
    ).filter(isApiKeyProviderId);
    const providersRequiringAudit = affectedApiKeyProviderIds.filter(
      (providerId) => {
        const intent = permissionConnectIntents.get(providerId);
        if (!intent) return true;
        intent.eventObserved = true;
        if (!intent.inProgress) {
          permissionConnectIntents.delete(providerId);
        }
        return false;
      },
    );
    const cleanups = beginApiKeyProviderCleanups(providersRequiringAudit);
    if (providersRequiringAudit.length === 0) {
      return;
    }
    const audit = credentialStorageReady
      .then(async () => {
        await completeApiKeyProviderCleanups(cleanups);
      });
    providersRequiringAudit.forEach((providerId) => {
      permissionAudits.set(providerId, audit);
    });
    void audit
      .then(credentialAwareCurrentState)
      .then(syncRefreshAlarm)
      .catch(() => undefined);
  });

  browser.permissions.onRemoved.addListener((permissions) => {
    const affectedProviderIds = providersAffectedByPermissionChange(
      permissions,
    );
    affectedProviderIds.filter(isApiKeyProviderId).forEach((providerId) => {
      permissionConnectIntents.delete(providerId);
      permissionAudits.delete(providerId);
      replaceApiKeyPermissionAuthority(providerId, false);
    });
    const cleanups = affectedProviderIds.map((providerId) =>
      providerOperationLane.beginCleanup(providerId),
    );
    affectedProviderIds.forEach((providerId) => {
      refreshOrchestrator.invalidateProvider(providerId);
      if (isApiKeyProviderId(providerId)) {
        apiKeyConnectionLifecycle.invalidateProvider(providerId);
      }
    });

    void credentialStorageReady
      .then(async (credentialStorageAvailable) => {
        await clearProviderConnectionSuppressions(affectedProviderIds);
        return reconcileRemovedProviderPermissions(
          permissions,
          credentialStorageAvailable
            ? providerIds
            : [
                ...browserSessionProviderIds,
                ...affectedProviderIds.filter(isApiKeyProviderId),
              ],
          () => undefined,
        );
      })
      .then(credentialAwareCurrentState)
      .then(syncRefreshAlarm)
      .finally(() => {
        cleanups.forEach((cleanup) =>
          providerOperationLane.endCleanup(cleanup),
        );
      })
      .catch(() => undefined);
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      launchScheduledRefresh({
        refreshAll: (trigger) => refreshOrchestrator.refreshAll(trigger),
        currentState: credentialAwareCurrentState,
        syncRefreshAlarm,
      });
    }
  });

});
