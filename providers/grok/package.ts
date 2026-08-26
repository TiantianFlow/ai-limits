import type { ProviderInstanceRecord } from "../../domain/model";
import { normalizeFixedConfig } from "../package-factories";
import type {
  CollectionResult,
  ProviderCollector,
  ProviderPackage,
  ProviderRuntimeServices,
} from "../types";
import { providerDefinitions } from "../definitions";
import {
  cleanupAbandonedOwnedTabs,
  openOwnedBackgroundTab,
  releaseOwnedBackgroundTab,
  type ListenerCleanup,
  type RemovedListener,
  type UpdatedListener,
} from "../tab-ensure";
import { grokAdapter } from "./adapter";
import {
  GROK_OWNED_TAB_LEASE_PREFIX,
  GROK_OWNED_TAB_TIMEOUT_MS,
  GROK_OWNED_TAB_URL,
  fetchFromGrokPageRead,
  findGrokPageSession,
  healthFromGrokPageProbe,
  type GrokPageProbe,
} from "./page-session";

interface GrokPackageDependencies {
  collect: ProviderCollector<"grok">["collect"];
  findPageSession(options: {
    allowOwnedTab: boolean;
  }): Promise<GrokPageProbe>;
  cleanupAbandonedOwnedTab?(): Promise<void>;
}

function matchesGrok(instance: ProviderInstanceRecord): boolean {
  return (
    instance.providerKind === "grok" &&
    normalizeFixedConfig(instance.config) !== undefined
  );
}

export function createGrokPackage(
  dependencies: GrokPackageDependencies,
): ProviderPackage {
  return {
    kind: "grok",
    cardinality: providerDefinitions.grok.cardinality,
    credentialKind: providerDefinitions.grok.credentialKind,
    configKind: providerDefinitions.grok.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: (config) =>
      normalizeFixedConfig(config)
        ? {
            origins: [...providerDefinitions.grok.optionalOrigins],
            permissions: [...providerDefinitions.grok.optionalPermissions],
          }
        : undefined,
    async startup(): Promise<void> {
      try {
        await dependencies.cleanupAbandonedOwnedTab?.();
      } catch {
        // Startup cleanup must never block background registration.
      }
    },
    async collect(instance, services): Promise<CollectionResult> {
      if (!matchesGrok(instance)) {
        return { ok: false, health: { kind: "provider_changed" } };
      }
      if (services.signal.aborted) {
        return { ok: false, health: { kind: "temporary_error" } };
      }

      let probe: GrokPageProbe;
      try {
        probe = await dependencies.findPageSession({
          allowOwnedTab: services.interaction === "allowed",
        });
      } catch {
        probe = { kind: "inject_threw", detail: "findPageSession threw" };
      }
      if (probe.kind !== "read") {
        console.debug("[grok] page-probe:", probe);
        return { ok: false, health: healthFromGrokPageProbe(probe) };
      }
      return dependencies.collect({
        fetch: fetchFromGrokPageRead(probe, services.signal),
        now: services.now,
        signal: services.signal,
      });
    },
  };
}

function grokOwnedTabBrowser() {
  return {
    createTab: (details: { url: string; active: false }) =>
      browser.tabs.create(details),
    getTab: (tabId: number) => browser.tabs.get(tabId),
    removeTab: (tabId: number) => browser.tabs.remove(tabId),
    addUpdatedListener: (listener: UpdatedListener): ListenerCleanup => {
      browser.tabs.onUpdated.addListener(listener);
      return () => browser.tabs.onUpdated.removeListener(listener);
    },
    addRemovedListener: (listener: RemovedListener): ListenerCleanup => {
      browser.tabs.onRemoved.addListener(listener);
      return () => browser.tabs.onRemoved.removeListener(listener);
    },
    storageSession: browser.storage.session,
  };
}

export const grokPackage = createGrokPackage({
  collect: (context) => grokAdapter.collect(context),
  findPageSession: ({ allowOwnedTab }) => {
    const tabs = grokOwnedTabBrowser();
    return findGrokPageSession({
      hasPagePermission: async () => {
        try {
          return Boolean(
            await browser.permissions.contains({
              origins: [...providerDefinitions.grok.optionalOrigins],
              permissions: [...providerDefinitions.grok.optionalPermissions],
            }),
          );
        } catch {
          return false;
        }
      },
      queryTabs: (details) => browser.tabs.query(details),
      executeScript: (details) => browser.scripting.executeScript(details),
      openOwnedTab: allowOwnedTab
        ? async () => {
            const owned = await openOwnedBackgroundTab({
              url: GROK_OWNED_TAB_URL,
              leaseKeyPrefix: GROK_OWNED_TAB_LEASE_PREFIX,
              deadline: Date.now() + GROK_OWNED_TAB_TIMEOUT_MS,
              ...tabs,
            });
            if (!owned) return undefined;
            return {
              tabId: owned.tabId,
              release: () =>
                releaseOwnedBackgroundTab({
                  tabId: owned.tabId,
                  leaseKey: owned.leaseKey,
                  removeTab: tabs.removeTab,
                  storageSession: tabs.storageSession,
                }),
            };
          }
        : undefined,
    });
  },
  cleanupAbandonedOwnedTab: () => {
    const tabs = grokOwnedTabBrowser();
    return cleanupAbandonedOwnedTabs({
      storageSession: tabs.storageSession,
      getTab: tabs.getTab,
      removeTab: tabs.removeTab,
      leaseKeyPrefix: GROK_OWNED_TAB_LEASE_PREFIX,
      remainsOnOwnedUrl: (url) =>
        url === GROK_OWNED_TAB_URL ||
        url?.startsWith("https://grok.com/") === true,
    });
  },
});
