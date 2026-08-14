import type {
  ProviderInstanceConfig,
  ProviderInstanceId,
} from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
  ProviderPackage,
  ProviderRuntimeServices,
} from "../types";
import { providerDefinitions } from "../definitions";
import {
  kimiAdapter,
  retryKimiAdapterAfterChangedToken,
} from "./adapter";
import { readKimiPageAccessToken } from "./page-session";
import {
  cleanupAbandonedKimiRecoveryTab,
  createKimiRecoveryAfterStartupCleanup,
  findKimiPageAccessToken,
  refreshKimiAccessTokenInTemporaryTab,
} from "./session-recovery";

const KIMI_URL = "https://www.kimi.com/";
const KIMI_ORIGIN_PATTERN = providerDefinitions.kimi.optionalOrigins[0];

interface KimiPackageDependencies {
  adapter: ProviderCollector<"kimi">;
  getCookieToken(): Promise<string | undefined>;
  findPageAccessToken(): Promise<string | undefined>;
  recoverAccessToken(
    rejectedToken: string | undefined,
    signal: AbortSignal,
  ): Promise<string | undefined>;
  cleanupAbandonedRecovery(): Promise<void>;
  announceRecovery(instanceId: ProviderInstanceId): void;
  retryAfterChangedToken?(
    result: CollectionResult,
    context: CollectionContext,
  ): Promise<CollectionResult>;
}

function normalizedToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token ? token : undefined;
}

async function safelyResolveToken(
  resolver: () => Promise<string | undefined>,
): Promise<string | undefined> {
  try {
    return normalizedToken(await resolver());
  } catch {
    return undefined;
  }
}

function fixedConfig(value: unknown): ProviderInstanceConfig | undefined {
  return typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "fixed"
    ? { kind: "fixed" }
    : undefined;
}

function recoveryFailure(): CollectionResult {
  return {
    ok: false,
    health: {
      kind: "temporary_error",
      guidance: "retry_session",
    },
  };
}

function requiresSession(result: CollectionResult): boolean {
  return (
    !result.ok &&
    "deferred" in result &&
    result.deferred.reason === "session_required"
  );
}

export function createKimiPackage(
  dependencies: KimiPackageDependencies,
): ProviderPackage {
  let startupCleanup: Promise<void> | undefined;
  const ensureStartup = (): Promise<void> => {
    startupCleanup ??= Promise.resolve().then(() =>
      dependencies.cleanupAbandonedRecovery(),
    );
    return startupCleanup;
  };

  const recoverAfterStartup = (
    instanceId: ProviderInstanceId,
    rejectedToken: string | undefined,
    services: ProviderRuntimeServices,
  ): Promise<string | undefined> => {
    return createKimiRecoveryAfterStartupCleanup({
      startupCleanup: ensureStartup(),
      signal: services.signal,
      recoverAccessToken: (token) => {
        if (services.signal.aborted) return Promise.resolve(undefined);
        dependencies.announceRecovery(instanceId);
        return dependencies.recoverAccessToken(token, services.signal);
      },
    })(rejectedToken).catch(() => undefined);
  };

  return {
    kind: "kimi",
    cardinality: providerDefinitions.kimi.cardinality,
    credentialKind: providerDefinitions.kimi.credentialKind,
    configKind: providerDefinitions.kimi.configKind,
    failureGuidance: {
      retry_session:
        "Kimi was still starting. Try Refresh once more, or open or reload Kimi.",
    },
    normalizeConfig: fixedConfig,
    requiredPermissions: (config) =>
      fixedConfig(config)
        ? {
            origins: [KIMI_ORIGIN_PATTERN],
            permissions: [...providerDefinitions.kimi.optionalPermissions],
          }
        : undefined,
    async startup(): Promise<void> {
      try {
        await ensureStartup();
      } catch {
        // The rejected cleanup state still gates recovery, but startup is safe
        // for the background worker's fire-and-forget lifecycle hook.
      }
    },
    async collect(instance, services): Promise<CollectionResult> {
      if (instance.providerKind !== "kimi" || !fixedConfig(instance.config)) {
        return { ok: false, health: { kind: "provider_changed" } };
      }
      if (services.signal.aborted) {
        return { ok: false, health: { kind: "temporary_error" } };
      }

      let token = await safelyResolveToken(() => dependencies.getCookieToken());
      if (!token) {
        token = await safelyResolveToken(() =>
          dependencies.findPageAccessToken(),
        );
      }

      if (!token) {
        if (services.interaction === "forbidden") {
          return {
            ok: false,
            deferred: { reason: "session_required" },
          };
        }
        token = normalizedToken(
          await recoverAfterStartup(instance.id, undefined, services),
        );
        if (!token) return recoveryFailure();
        const result = await dependencies.adapter.collect({
          fetch: services.fetch,
          now: services.now,
          signal: services.signal,
          accessToken: token,
        });
        return requiresSession(result) ? recoveryFailure() : result;
      }

      const firstResult = await dependencies.adapter.collect({
        fetch: services.fetch,
        now: services.now,
        signal: services.signal,
        accessToken: token,
      });
      if (!requiresSession(firstResult)) return firstResult;

      let changedToken = await safelyResolveToken(
        () => dependencies.findPageAccessToken(),
      );
      if (changedToken === token) changedToken = undefined;
      if (!changedToken && services.interaction === "allowed") {
        changedToken = normalizedToken(
          await recoverAfterStartup(instance.id, token, services),
        );
        if (changedToken === token) changedToken = undefined;
      }
      if (!changedToken) {
        return services.interaction === "forbidden"
          ? firstResult
          : recoveryFailure();
      }

      const retryContext = {
        fetch: services.fetch,
        now: services.now,
        signal: services.signal,
        accessToken: changedToken,
      };
      const retryResult = await (
        dependencies.retryAfterChangedToken ??
        ((_result, context) => dependencies.adapter.collect(context))
      )(firstResult, retryContext);
      return requiresSession(retryResult) && services.interaction === "allowed"
        ? recoveryFailure()
        : retryResult;
    },
  };
}

function productionDependencies(): KimiPackageDependencies {
  const readPageToken = (tabId: number) =>
    readKimiPageAccessToken(tabId, (details) =>
      browser.scripting.executeScript(details),
    );

  return {
    adapter: kimiAdapter,
    async getCookieToken() {
      return (await browser.cookies.get({ url: KIMI_URL, name: "kimi-auth" }))
        ?.value;
    },
    findPageAccessToken: () =>
      findKimiPageAccessToken({
        queryTabs: () => browser.tabs.query({ url: KIMI_ORIGIN_PATTERN }),
        readAccessToken: readPageToken,
      }),
    recoverAccessToken: (rejectedToken, signal) =>
      refreshKimiAccessTokenInTemporaryTab({
        rejectedToken,
        createTab: (details) => browser.tabs.create(details),
        getTab: (tabId) => browser.tabs.get(tabId),
        readAccessToken: readPageToken,
        removeTab: (tabId) => browser.tabs.remove(tabId),
        addUpdatedListener: (listener) => {
          browser.tabs.onUpdated.addListener(listener);
          return () => browser.tabs.onUpdated.removeListener(listener);
        },
        addRemovedListener: (listener) => {
          browser.tabs.onRemoved.addListener(listener);
          return () => browser.tabs.onRemoved.removeListener(listener);
        },
        storageSession: browser.storage.session,
        signal,
      }),
    cleanupAbandonedRecovery: () =>
      cleanupAbandonedKimiRecoveryTab({
        storageSession: browser.storage.session,
        getTab: (tabId) => browser.tabs.get(tabId),
        removeTab: (tabId) => browser.tabs.remove(tabId),
      }),
    announceRecovery(instanceId) {
      void browser.runtime
        .sendMessage({
          type: "PROVIDER_OPERATION",
          instanceId,
          operation: "waiting_for_session",
        })
        .catch(() => undefined);
    },
    retryAfterChangedToken: retryKimiAdapterAfterChangedToken,
  };
}

export const kimiPackage = createKimiPackage(productionDependencies());
