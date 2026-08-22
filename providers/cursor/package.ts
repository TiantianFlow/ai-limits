import type { ProviderInstanceRecord } from "../../domain/model";
import { normalizeFixedConfig } from "../package-factories";
import type {
  CollectionContext,
  CollectionResult,
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
import { collectCursor } from "./adapter";
import { applyCursorPageMetrics } from "./page-metrics";
import {
  CURSOR_OWNED_TAB_LEASE_PREFIX,
  CURSOR_OWNED_TAB_TIMEOUT_MS,
  CURSOR_OWNED_TAB_URL,
  dashboardJsonFromProbe,
  findCursorDashboardJson,
  type CursorDashboardJson,
  type CursorDashboardProbe,
} from "./page-dashboard";

interface CursorPackageDependencies {
  collect(
    context: CollectionContext,
    dashboard: CursorDashboardJson,
  ): Promise<CollectionResult>;
  findDashboardJson(): Promise<CursorDashboardProbe>;
  cleanupAbandonedOwnedTab?(): Promise<void>;
}

function adapterContext(services: ProviderRuntimeServices): CollectionContext {
  return {
    fetch: services.fetch,
    now: services.now,
    signal: services.signal,
  };
}

function matchesCursor(instance: ProviderInstanceRecord): boolean {
  return (
    instance.providerKind === "cursor" &&
    normalizeFixedConfig(instance.config) !== undefined
  );
}

export function createCursorPackage(
  dependencies: CursorPackageDependencies,
): ProviderPackage {
  return {
    kind: "cursor",
    cardinality: providerDefinitions.cursor.cardinality,
    credentialKind: providerDefinitions.cursor.credentialKind,
    configKind: providerDefinitions.cursor.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: (config) =>
      normalizeFixedConfig(config)
        ? {
            origins: [...providerDefinitions.cursor.optionalOrigins],
            permissions: [...providerDefinitions.cursor.optionalPermissions],
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
      if (!matchesCursor(instance)) {
        return { ok: false, health: { kind: "provider_changed" } };
      }

      let probe: CursorDashboardProbe | { kind: "skipped" } = { kind: "skipped" };
      if (services.interaction === "allowed" && !services.signal.aborted) {
        try {
          probe = await dependencies.findDashboardJson();
        } catch {
          probe = { kind: "inject_threw", detail: "findDashboardJson threw" };
        }
      }
      const dashboard =
        probe.kind === "skipped" ? {} : dashboardJsonFromProbe(probe);
      const result = await dependencies.collect(
        adapterContext(services),
        dashboard,
      );
      return applyCursorPageMetrics(
        result,
        instance.snapshot,
        probe,
        services.now,
      );
    },
  };
}

function cursorOwnedTabBrowser() {
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

export const cursorPackage = createCursorPackage({
  collect: collectCursor,
  findDashboardJson: () => {
    const tabs = cursorOwnedTabBrowser();
    return findCursorDashboardJson({
      hasPagePermission: async () => {
        try {
          return Boolean(
            await browser.permissions.contains({
              origins: [...providerDefinitions.cursor.optionalOrigins],
              permissions: [...providerDefinitions.cursor.optionalPermissions],
            }),
          );
        } catch {
          return false;
        }
      },
      queryTabs: (details) => browser.tabs.query(details),
      executeScript: (details) => browser.scripting.executeScript(details),
      openOwnedTab: async () => {
        const owned = await openOwnedBackgroundTab({
          url: CURSOR_OWNED_TAB_URL,
          leaseKeyPrefix: CURSOR_OWNED_TAB_LEASE_PREFIX,
          deadline: Date.now() + CURSOR_OWNED_TAB_TIMEOUT_MS,
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
      },
    });
  },
  cleanupAbandonedOwnedTab: () => {
    const tabs = cursorOwnedTabBrowser();
    return cleanupAbandonedOwnedTabs({
      storageSession: tabs.storageSession,
      getTab: tabs.getTab,
      removeTab: tabs.removeTab,
      leaseKeyPrefix: CURSOR_OWNED_TAB_LEASE_PREFIX,
      remainsOnOwnedUrl: (url) =>
        url === CURSOR_OWNED_TAB_URL ||
        url?.startsWith(CURSOR_OWNED_TAB_URL) === true,
    });
  },
});
