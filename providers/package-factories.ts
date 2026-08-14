import type {
  ProviderInstanceConfig,
  ProviderInstanceRecord,
} from "../domain/instances";
import {
  providerCatalog,
  type ApiKeyProviderKind,
  type BrowserSessionProviderKind,
  type ProviderKind,
} from "./catalog";
import {
  newApiPermissionOrigin,
  normalizeNewApiBaseUrl,
} from "./newapi/url";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
  ProviderCredential,
  ProviderPackage,
  ProviderRuntimeServices,
} from "./types";

export function normalizeProviderConfig(
  kind: ProviderKind,
  value: unknown,
): ProviderInstanceConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const connection = providerCatalog[kind].connection;
  if (connection.kind !== "api-key" || connection.origin !== "dynamic") {
    return (value as { kind?: unknown }).kind === "fixed"
      ? { kind: "fixed" }
      : undefined;
  }

  if ((value as { kind?: unknown }).kind !== "dynamic-origin") {
    return undefined;
  }
  const baseUrl = normalizeNewApiBaseUrl(
    (value as { baseUrl?: unknown }).baseUrl,
  );
  return baseUrl
    ? { kind: "dynamic-origin", baseUrl }
    : undefined;
}

export function requiredPermissionsForProviderConfig(
  kind: ProviderKind,
  config: ProviderInstanceConfig,
): Browser.permissions.Permissions | undefined {
  const definition = providerCatalog[kind];
  const origins =
    definition.connection.kind === "api-key" &&
    definition.connection.origin === "dynamic"
      ? config.kind === "dynamic-origin"
        ? [newApiPermissionOrigin(config.baseUrl)].filter(
            (origin): origin is string => origin !== undefined,
          )
        : []
      : [...definition.optionalOrigins];
  const permissions = [...definition.optionalPermissions];
  return origins.length || permissions.length
    ? {
        ...(origins.length ? { origins } : {}),
        ...(permissions.length ? { permissions } : {}),
      }
    : undefined;
}

function matchesPackage(
  kind: ProviderKind,
  instance: ProviderInstanceRecord,
): ProviderInstanceConfig | undefined {
  if (instance.providerKind !== kind) return undefined;
  return normalizeProviderConfig(kind, instance.config);
}

function adapterContext(
  services: ProviderRuntimeServices,
): CollectionContext {
  return {
    fetch: services.fetch,
    now: services.now,
    signal: services.signal,
  };
}

export function createBrowserSessionPackage<
  Kind extends Exclude<BrowserSessionProviderKind, "kimi">,
>({
  kind,
  adapter,
}: {
  kind: Kind;
  adapter: ProviderAdapter<Kind>;
}): ProviderPackage {
  return {
    kind,
    cardinality: providerCatalog[kind].cardinality,
    credentialKind: "none",
    normalizeConfig: (value) => normalizeProviderConfig(kind, value),
    requiredPermissions: (config) => {
      const normalizedConfig = normalizeProviderConfig(kind, config);
      return normalizedConfig
        ? requiredPermissionsForProviderConfig(kind, normalizedConfig)
        : undefined;
    },
    collect(instance, services): Promise<CollectionResult> {
      if (!matchesPackage(kind, instance)) {
        return Promise.resolve({
          ok: false,
          health: { kind: "provider_changed" },
        });
      }
      return adapter.collect(adapterContext(services));
    },
  };
}

export function createApiKeyPackage<Kind extends ApiKeyProviderKind>({
  kind,
  adapter,
}: {
  kind: Kind;
  adapter: ProviderAdapter<Kind>;
}): ProviderPackage {
  return {
    kind,
    cardinality: providerCatalog[kind].cardinality,
    credentialKind: "api-key",
    normalizeConfig: (value) => normalizeProviderConfig(kind, value),
    requiredPermissions: (config) => {
      const normalizedConfig = normalizeProviderConfig(kind, config);
      return normalizedConfig
        ? requiredPermissionsForProviderConfig(kind, normalizedConfig)
        : undefined;
    },
    collect(instance, services, credentialOverride): Promise<CollectionResult> {
      const normalizedConfig = matchesPackage(kind, instance);
      const credential = normalizeCredential(credentialOverride);
      if (!normalizedConfig) {
        return Promise.resolve({
          ok: false,
          health: { kind: "provider_changed" },
        });
      }
      if (!credential) {
        return Promise.resolve({
          ok: false,
          health: { kind: "signed_out" },
        });
      }

      return adapter.collect({
        ...adapterContext(services),
        credential,
        ...(normalizedConfig.kind === "dynamic-origin"
          ? { baseUrl: normalizedConfig.baseUrl }
          : {}),
      });
    },
  };
}

function normalizeCredential(
  value: ProviderCredential | undefined,
): ProviderCredential | undefined {
  if (value?.kind !== "api-key") return undefined;
  const apiKey = value.value.trim();
  return apiKey ? { kind: "api-key", value: apiKey } : undefined;
}
