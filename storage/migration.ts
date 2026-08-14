import type { InstanceAppState, ProviderInstanceRecord } from "../domain/instances";
import type { DisplayMode, UsageHistoryObservation } from "../domain/model";
import type { ProviderKind, ApiKeyProviderKind } from "../providers/catalog";
import { isApiKeyProviderId, isProviderId, providerCatalog, providerIds } from "../providers/catalog";
import { normalizeNewApiBaseUrl, newApiPermissionOrigin } from "../providers/newapi/url";
import { convertReleasedV4ProviderWire } from "../providers/v4-wire-migration";
import {
  CREDENTIAL_STORAGE_KEY,
  emptyCredentialStateV2,
  normalizeCredentialStateV2,
  type CredentialStateV2,
  type CredentialStatus,
  type VersionedStoredApiKeyCredential,
} from "./credential-vault";
import {
  createEmptyInstanceAppState,
  normalizeInstanceAppState,
} from "./state-codec";

export const LEGACY_STATE_STORAGE_KEY = "aiLimitsState";
export const LEGACY_SUPPRESSION_STORAGE_KEY =
  "aiLimitsConnectionSuppressions";

export interface LegacyStorageInput {
  aiLimitsState?: unknown;
  aiLimitsCredentials?: unknown;
  aiLimitsConnectionSuppressions?: unknown;
}

export interface MigratedLegacyStorage {
  state: InstanceAppState;
  credentialState: CredentialStateV2;
}

interface LegacyCredential extends VersionedStoredApiKeyCredential {
  baseUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 4_096
    ? normalized
    : undefined;
}

function normalizeLegacyCredential(
  providerKind: ApiKeyProviderKind,
  value: unknown,
): LegacyCredential | undefined {
  if (
    !isRecord(value) ||
    value.kind !== "api-key" ||
    (value.status !== "active" && value.status !== "rejected")
  ) {
    return undefined;
  }
  const apiKey = normalizeApiKey(value.value);
  if (!apiKey) return undefined;
  const baseUrl =
    providerKind === "newapi"
      ? normalizeNewApiBaseUrl(value.baseUrl)
      : undefined;
  if (providerKind === "newapi" && !baseUrl) return undefined;
  return {
    kind: "api-key",
    value: apiKey,
    status: value.status as CredentialStatus,
    revision:
      typeof value.revision === "string" && value.revision.length > 0
        ? value.revision
        : `legacy:${providerKind}`,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

function normalizeLegacyCredentials(
  value: unknown,
): Partial<Record<ApiKeyProviderKind, LegacyCredential>> {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.providers)
  ) {
    return {};
  }
  const credentials: Partial<Record<ApiKeyProviderKind, LegacyCredential>> = {};
  for (const [providerKind, candidate] of Object.entries(value.providers)) {
    if (!isApiKeyProviderId(providerKind)) continue;
    const credential = normalizeLegacyCredential(providerKind, candidate);
    if (credential) credentials[providerKind] = credential;
  }
  return credentials;
}

function normalizedSuppressions(value: unknown): Set<ProviderKind> {
  return new Set(
    Array.isArray(value) ? value.filter(isProviderId) : [],
  );
}

function hasGrantedPermission(
  providerKind: ProviderKind,
  credential: LegacyCredential | undefined,
  grantedPermissions: Browser.permissions.Permissions,
): boolean {
  const origins = new Set(grantedPermissions.origins ?? []);
  const permissions = new Set(
    (grantedPermissions.permissions ?? []) as readonly string[],
  );
  const catalog = providerCatalog[providerKind];
  const requiredOrigins =
    providerKind === "newapi"
      ? [newApiPermissionOrigin(credential?.baseUrl)].filter(
          (origin): origin is string => origin !== undefined,
        )
      : [...catalog.optionalOrigins];
  if (requiredOrigins.length === 0) return false;
  return (
    requiredOrigins.every((origin) => origins.has(origin)) &&
    catalog.optionalPermissions.every((permission) =>
      permissions.has(permission),
    )
  );
}

function quotaOnlyHistory(
  history: readonly UsageHistoryObservation[],
): UsageHistoryObservation[] {
  return history.flatMap((observation) => {
    const metrics = observation.metrics.filter(
      (metric) => metric.type === "quota",
    );
    return metrics.length === 0 ? [] : [{ ...observation, metrics }];
  });
}

function releasedPreferences(value: Record<string, unknown>): {
  displayMode: DisplayMode;
  autoRefresh: boolean;
} {
  const preferences = isRecord(value.preferences) ? value.preferences : {};
  return {
    displayMode: preferences.displayMode === "left" ? "left" : "used",
    autoRefresh:
      typeof preferences.autoRefresh === "boolean"
        ? preferences.autoRefresh
        : true,
  };
}

function migrateReleasedV4(
  stateValue: unknown,
  credentialValue: unknown,
  suppressionValue: unknown,
  now: number,
  grantedPermissions: Browser.permissions.Permissions,
): MigratedLegacyStorage {
  if (!isRecord(stateValue) || stateValue.version !== 4) {
    return {
      state: createEmptyInstanceAppState(),
      credentialState: emptyCredentialStateV2(),
    };
  }
  const credentials = normalizeLegacyCredentials(credentialValue);
  const suppressions = normalizedSuppressions(suppressionValue);
  const instances: ProviderInstanceRecord[] = [];
  const migratedCredentials: CredentialStateV2["credentials"] = {};
  const storedProviders = Array.isArray(stateValue.providers)
    ? stateValue.providers
    : [];

  for (const providerKind of providerIds) {
    if (suppressions.has(providerKind)) continue;
    const storedProvider = storedProviders.find(
      (candidate) =>
        isRecord(candidate) && candidate.providerId === providerKind,
    );
    const credential = isApiKeyProviderId(providerKind)
      ? credentials[providerKind]
      : undefined;
    const permissionGranted = hasGrantedPermission(
      providerKind,
      credential,
      grantedPermissions,
    );
    const browserSession =
      providerCatalog[providerKind].connection.kind === "browser-session";
    const id = `${providerKind}:default`;
    const config =
      providerKind === "newapi"
        ? credential?.baseUrl
          ? { kind: "dynamic-origin" as const, baseUrl: credential.baseUrl }
          : undefined
        : { kind: "fixed" as const };
    if (!config) continue;
    const released = isRecord(storedProvider)
      ? convertReleasedV4ProviderWire(storedProvider, providerKind)
      : {};
    const normalizedProvider = normalizeInstanceAppState(
      {
        version: 5,
        preferences: { displayMode: "used", autoRefresh: true },
        instances: [
          {
            id,
            providerKind,
            config,
            access: permissionGranted ? "granted" : "required",
            createdAt: now,
            history: released.history,
            ...(released.snapshot === undefined
              ? {}
              : { snapshot: released.snapshot }),
            ...(isRecord(storedProvider) &&
            storedProvider.lastAttempt !== undefined
              ? { lastAttempt: storedProvider.lastAttempt }
              : {}),
          },
        ],
      },
      now,
    ).instances[0];
    const durableData = Boolean(
      normalizedProvider?.snapshot ||
        normalizedProvider?.lastAttempt ||
        normalizedProvider?.history.length,
    );
    if (!durableData && !credential && !(browserSession && permissionGranted)) {
      continue;
    }
    if (!normalizedProvider) continue;
    const instance: ProviderInstanceRecord = {
      ...normalizedProvider,
      history: quotaOnlyHistory(normalizedProvider.history),
    };
    instances.push(instance);
    if (credential) {
      const { baseUrl: _baseUrl, ...storedCredential } = credential;
      migratedCredentials[id] = storedCredential;
    }
  }

  return {
    state: normalizeInstanceAppState(
      {
        version: 5,
        preferences: releasedPreferences(stateValue),
        instances,
      },
      now,
    ),
    credentialState: normalizeCredentialStateV2({
      version: 2,
      credentials: migratedCredentials,
    }),
  };
}

export function migrateLegacyStorage(
  input: LegacyStorageInput,
  now: number,
  grantedPermissions: Browser.permissions.Permissions,
): MigratedLegacyStorage {
  if (isRecord(input.aiLimitsState) && input.aiLimitsState.version === 5) {
    const state = normalizeInstanceAppState(input.aiLimitsState, now);
    const normalizedCredentials = normalizeCredentialStateV2(
      input.aiLimitsCredentials,
    );
    const activeApiKeyInstances = new Set(
      state.instances
        .filter(({ providerKind }) => isApiKeyProviderId(providerKind))
        .map(({ id }) => id),
    );
    const credentials = Object.fromEntries(
      Object.entries(normalizedCredentials.credentials).filter(([instanceId]) =>
        activeApiKeyInstances.has(instanceId),
      ),
    );
    return {
      state,
      credentialState: { version: 2, credentials },
    };
  }
  return migrateReleasedV4(
    input.aiLimitsState,
    input.aiLimitsCredentials,
    input.aiLimitsConnectionSuppressions,
    now,
    grantedPermissions,
  );
}

export async function migrateLegacyStorageInPlace(
  now: number,
  grantedPermissions: Browser.permissions.Permissions,
): Promise<MigratedLegacyStorage> {
  const stored = (await browser.storage.local.get([
    LEGACY_STATE_STORAGE_KEY,
    CREDENTIAL_STORAGE_KEY,
    LEGACY_SUPPRESSION_STORAGE_KEY,
  ])) as LegacyStorageInput;
  const migrated = migrateLegacyStorage(stored, now, grantedPermissions);
  await browser.storage.local.set({
    [LEGACY_STATE_STORAGE_KEY]: migrated.state,
    [CREDENTIAL_STORAGE_KEY]: migrated.credentialState,
  });
  await browser.storage.local.remove(LEGACY_SUPPRESSION_STORAGE_KEY);
  return migrated;
}
