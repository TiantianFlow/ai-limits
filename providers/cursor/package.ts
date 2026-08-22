import type { ProviderInstanceRecord } from "../../domain/model";
import { normalizeFixedConfig } from "../package-factories";
import type {
  CollectionContext,
  CollectionResult,
  ProviderPackage,
  ProviderRuntimeServices,
} from "../types";
import { providerDefinitions } from "../definitions";
import { collectCursor } from "./adapter";
import { applyCursorPageMetrics } from "./page-metrics";
import {
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
    async collect(instance, services): Promise<CollectionResult> {
      if (!matchesCursor(instance)) {
        return { ok: false, health: { kind: "provider_changed" } };
      }

      let probe: CursorDashboardProbe | { kind: "skipped" } = { kind: "skipped" };
      if (services.interaction === "allowed" && !services.signal.aborted) {
        try {
          probe = await dependencies.findDashboardJson();
        } catch {
          probe = { kind: "injection_failed" };
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

export const cursorPackage = createCursorPackage({
  collect: collectCursor,
  findDashboardJson: () =>
    findCursorDashboardJson({
      queryTabs: (details) => browser.tabs.query(details),
      executeScript: (details) => browser.scripting.executeScript(details),
    }),
});
