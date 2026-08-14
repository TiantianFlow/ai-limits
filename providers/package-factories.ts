import type {
  ProviderInstanceConfig,
  ProviderInstanceRecord,
} from "../domain/model";
import type {
  ApiKeyProviderKind,
  BrowserSessionProviderKind,
  ProviderKind,
} from "./catalog";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
  ProviderCredential,
  ProviderPackage,
  ProviderRuntimeServices,
} from "./types";

export function normalizeFixedConfig(
  value: unknown,
): ProviderInstanceConfig | undefined {
  return typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "fixed"
    ? { kind: "fixed" }
    : undefined;
}

function matchesPackage(
  kind: ProviderKind,
  instance: ProviderInstanceRecord,
  normalizeConfig: (value: unknown) => ProviderInstanceConfig | undefined,
): ProviderInstanceConfig | undefined {
  if (instance.providerKind !== kind) return undefined;
  return normalizeConfig(instance.config);
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
  cardinality,
  requiredPermissions,
}: {
  kind: Kind;
  adapter: ProviderCollector<Kind>;
  cardinality: "single" | "multiple";
  requiredPermissions: (
    config: ProviderInstanceConfig,
  ) => Browser.permissions.Permissions | undefined;
}): ProviderPackage {
  return {
    kind,
    cardinality,
    credentialKind: "none",
    configKind: "fixed",
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions,
    collect(instance, services): Promise<CollectionResult> {
      if (!matchesPackage(kind, instance, normalizeFixedConfig)) {
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
  cardinality,
  configKind,
  normalizeConfig,
  requiredPermissions,
}: {
  kind: Kind;
  adapter: ProviderCollector<Kind>;
  cardinality: "single" | "multiple";
  configKind: ProviderInstanceConfig["kind"];
  normalizeConfig: (value: unknown) => ProviderInstanceConfig | undefined;
  requiredPermissions: (
    config: ProviderInstanceConfig,
  ) => Browser.permissions.Permissions | undefined;
}): ProviderPackage {
  return {
    kind,
    cardinality,
    credentialKind: "api-key",
    configKind,
    normalizeConfig,
    requiredPermissions,
    collect(instance, services, credentialOverride): Promise<CollectionResult> {
      const normalizedConfig = matchesPackage(kind, instance, normalizeConfig);
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
