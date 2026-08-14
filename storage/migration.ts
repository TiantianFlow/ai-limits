import type { InstanceAppState, ProviderInstanceRecord } from "../domain/model";
import type {
  DisplayMode,
  MetricCycle,
  MetricScope,
  UsageHistoryObservation,
} from "../domain/model";
import type { ProviderKind, ApiKeyProviderKind } from "../providers/catalog";
import { isApiKeyProviderKind, isProviderKind, providerKinds } from "../providers/catalog";
import { normalizeNewApiBaseUrl } from "../providers/newapi/url";
import { providerRegistry } from "../providers/registry";
import {
  CREDENTIAL_STORAGE_KEY,
  emptyCredentialStateV2,
  normalizeCredentialStateV2,
  type CredentialStateV2,
  type CredentialStatus,
  type VersionedStoredApiKeyCredential,
} from "./credentials";
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
    if (!isApiKeyProviderKind(providerKind)) continue;
    const credential = normalizeLegacyCredential(providerKind, candidate);
    if (credential) credentials[providerKind] = credential;
  }
  return credentials;
}

function normalizedSuppressions(value: unknown): Set<ProviderKind> {
  return new Set(
    Array.isArray(value) ? value.filter(isProviderKind) : [],
  );
}

interface ParsedOriginPattern {
  scheme: "*" | "http" | "https";
  host: string;
  subdomainWildcard: boolean;
  port?: string;
}

function validExactHost(host: string): boolean {
  if (host.length === 0 || host.includes("*")) return false;
  try {
    const parsed = new URL(`https://${host}`);
    return (
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.hostname.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

function parseOriginPattern(value: unknown): ParsedOriginPattern | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(value);
  if (!match) return undefined;
  const path = match[3]!;
  if (/[\u0000-\u0020\u007f?#]/.test(path)) return undefined;
  const scheme = match[1] as ParsedOriginPattern["scheme"];
  const authority = match[2]!;
  const separator = authority.lastIndexOf(":");
  const hasPort = separator > 0 && authority.indexOf(":") === separator;
  const hostWithWildcard = hasPort
    ? authority.slice(0, separator)
    : authority;
  const port = hasPort ? authority.slice(separator + 1) : undefined;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return undefined;
  if (
    port !== undefined &&
    (Number(port) < 1 || Number(port) > 65_535)
  ) {
    return undefined;
  }
  if (hostWithWildcard === "*") {
    return { scheme, host: "*", subdomainWildcard: false, ...(port ? { port } : {}) };
  }
  const subdomainWildcard = hostWithWildcard.startsWith("*.");
  const host = subdomainWildcard
    ? hostWithWildcard.slice(2)
    : hostWithWildcard;
  if (!validExactHost(host)) return undefined;
  return {
    scheme,
    host: host.toLowerCase(),
    subdomainWildcard,
    ...(port ? { port } : {}),
  };
}

function grantedOriginCoversRequired(
  granted: unknown,
  required: string,
): boolean {
  const grantedPattern = parseOriginPattern(granted);
  const requiredPattern = parseOriginPattern(required);
  if (
    !grantedPattern ||
    !requiredPattern ||
    requiredPattern.scheme === "*" ||
    requiredPattern.host === "*" ||
    requiredPattern.subdomainWildcard
  ) {
    return false;
  }
  if (
    grantedPattern.scheme !== "*" &&
    grantedPattern.scheme !== requiredPattern.scheme
  ) {
    return false;
  }
  if (
    grantedPattern.port !== undefined &&
    grantedPattern.port !== requiredPattern.port
  ) {
    return false;
  }
  if (grantedPattern.host === "*") return true;
  if (grantedPattern.subdomainWildcard) {
    return (
      requiredPattern.host === grantedPattern.host ||
      requiredPattern.host.endsWith(`.${grantedPattern.host}`)
    );
  }
  return grantedPattern.host === requiredPattern.host;
}

function hasGrantedPermission(
  providerKind: ProviderKind,
  config: ProviderInstanceRecord["config"],
  grantedPermissions: Browser.permissions.Permissions,
): boolean {
  const origins = grantedPermissions.origins ?? [];
  const permissions = new Set(
    (grantedPermissions.permissions ?? []) as readonly string[],
  );
  const required = providerRegistry[providerKind].requiredPermissions(config);
  const requiredOrigins = required?.origins ?? [];
  if (requiredOrigins.length === 0) return false;
  return (
    requiredOrigins.every((requiredOrigin) =>
      origins.some((grantedOrigin) =>
        grantedOriginCoversRequired(grantedOrigin, requiredOrigin),
      ),
    ) &&
    ((required?.permissions ?? []) as readonly string[]).every((permission) =>
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

  for (const providerKind of providerKinds) {
    if (suppressions.has(providerKind)) continue;
    const storedProvider = storedProviders.find(
      (candidate) =>
        isRecord(candidate) && candidate.providerId === providerKind,
    );
    const credential = isApiKeyProviderKind(providerKind)
      ? credentials[providerKind]
      : undefined;
    const id = `${providerKind}:default`;
    const config =
      providerKind === "newapi"
        ? credential?.baseUrl
          ? { kind: "dynamic-origin" as const, baseUrl: credential.baseUrl }
          : undefined
        : { kind: "fixed" as const };
    if (!config) continue;
    const permissionGranted = hasGrantedPermission(
      providerKind,
      config,
      grantedPermissions,
    );
    const browserSession =
      providerRegistry[providerKind].credentialKind === "none";
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
            ...(credential
              ? { connectionRevision: credential.revision }
              : {}),
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
    const normalizedCredentials = normalizeCredentialStateV2(
      input.aiLimitsCredentials,
    );
    const state = normalizeInstanceAppState(
      input.aiLimitsState,
      now,
    );
    const boundApiKeyInstances = new Map(
      state.instances
        .filter(({ providerKind }) => isApiKeyProviderKind(providerKind))
        .map(({ id, connectionRevision }) => [id, connectionRevision]),
    );
    const credentials = Object.fromEntries(
      Object.entries(normalizedCredentials.credentials).filter(
        ([instanceId, credential]) =>
          boundApiKeyInstances.get(instanceId) === credential.revision,
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

interface ConvertedReleasedV4Wire {
  snapshot?: unknown;
  history?: unknown;
}

function metricScope(
  providerId: ProviderKind,
  id: unknown,
  kind: unknown,
): MetricScope {
  if (kind === "model") return "model";
  if (kind === "feature") return "feature";
  if (providerId === "elevenlabs" && id === "monthly-credits") {
    return "product";
  }
  return "general";
}

function metricCycle(
  providerId: ProviderKind,
  kind: unknown,
  value: Record<string, unknown>,
): MetricCycle | undefined {
  const hasTiming =
    value.startedAt !== undefined ||
    value.resetsAt !== undefined ||
    value.durationMs !== undefined;
  if (!hasTiming) return undefined;

  const cadence =
    kind === "calendar" || (providerId === "cursor" && kind === "model")
      ? "calendar"
      : "rolling";
  return {
    cadence,
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt as number }),
    ...(value.resetsAt === undefined ? {} : { resetsAt: value.resetsAt as number }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs as number }),
  };
}

function convertWindow(
  value: unknown,
  providerId: ProviderKind,
): Record<string, unknown> | undefined {
  if (
    !isRecord(value) ||
    !["rolling", "calendar", "model", "feature"].includes(value.kind as string) ||
    (value.sourceSemantics !== "used" && value.sourceSemantics !== "remaining")
  ) {
    return undefined;
  }

  const cycle = metricCycle(providerId, value.kind, value);
  return {
    type: "quota",
    id: value.id,
    label: value.label,
    scope: metricScope(providerId, value.id, value.kind),
    usedRatio: value.usedRatio,
    ...(value.used === undefined ? {} : { used: value.used }),
    ...(value.limit === undefined ? {} : { limit: value.limit }),
    ...(value.unit === undefined ? {} : { unit: value.unit }),
    ...(cycle === undefined ? {} : { cycle }),
    ...(value.segments === undefined ? {} : { segments: value.segments }),
  };
}

function creditCycle(value: Record<string, unknown>): MetricCycle | undefined {
  return value.resetsAt === undefined
    ? undefined
    : { cadence: "calendar", resetsAt: value.resetsAt as number };
}

function convertCredit(
  value: unknown,
  providerId: ProviderKind,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const cycle = creditCycle(value);
  const base = {
    id: value.id,
    label: value.label,
    scope: "product",
    unit: value.unit,
    ...(cycle === undefined ? {} : { cycle }),
  };

  if (providerId === "chatgpt") {
    return {
      ...base,
      type: "balance",
      value: value.remaining,
      ...(value.limit === undefined ? {} : { initialLimit: value.limit }),
    };
  }

  if (providerId === "claude" || providerId === "cursor") {
    return {
      ...base,
      type: "counter",
      semantic: "spent",
      value: value.used,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
    };
  }

  if (providerId === "newapi") {
    return {
      ...base,
      type: "counter",
      semantic: "consumed",
      value: value.used,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
    };
  }

  return undefined;
}

function convertGroups(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return value;

  return value.map((group) => {
    if (!isRecord(group)) return group;
    if (!Array.isArray(group.windowIds) || !Array.isArray(group.creditIds)) {
      return group;
    }
    const windowIds = group.windowIds;
    const creditIds = group.creditIds;
    return {
      id: group.id,
      label: group.label,
      ...(group.description === undefined ? {} : { description: group.description }),
      metricIds: [...windowIds, ...creditIds],
    };
  });
}

function convertSnapshot(
  value: unknown,
  providerId: ProviderKind,
): Record<string, unknown> | undefined {
  if (
    !isRecord(value) ||
    value.providerId !== providerId ||
    (value.source !== "web-session" &&
      value.source !== "oauth" &&
      value.source !== "api-key") ||
    !Array.isArray(value.windows) ||
    !Array.isArray(value.credits)
  ) {
    return undefined;
  }

  const windows = value.windows.map((window) => convertWindow(window, providerId));
  const credits = value.credits.map((credit) => convertCredit(credit, providerId));
  if (
    windows.some((window) => window === undefined) ||
    credits.some((credit) => credit === undefined)
  ) {
    return undefined;
  }

  const usageGroups = convertGroups(value.usageGroups);
  return {
    providerKind: providerId,
    ...(value.accountLabel === undefined ? {} : { accountLabel: value.accountLabel }),
    ...(value.planLabel === undefined ? {} : { planLabel: value.planLabel }),
    source: value.source,
    fetchedAt: value.fetchedAt,
    metrics: [...windows, ...credits],
    ...(usageGroups === undefined ? {} : { usageGroups }),
  };
}

function quotaCadences(snapshot: Record<string, unknown> | undefined) {
  const cadences = new Map<string, MetricCycle["cadence"]>();
  if (!snapshot || !Array.isArray(snapshot.metrics)) return cadences;
  for (const metric of snapshot.metrics) {
    if (
      isRecord(metric) &&
      metric.type === "quota" &&
      typeof metric.id === "string" &&
      isRecord(metric.cycle) &&
      (metric.cycle.cadence === "rolling" || metric.cycle.cadence === "calendar")
    ) {
      cadences.set(metric.id, metric.cycle.cadence);
    }
  }
  return cadences;
}

function convertHistory(
  value: unknown,
  cadences: ReadonlyMap<string, MetricCycle["cadence"]>,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((observation) => {
    if (!isRecord(observation) || !Array.isArray(observation.windows)) {
      return observation;
    }
    return {
      observedAt: observation.observedAt,
      metrics: observation.windows.map((sample) => {
        if (!isRecord(sample)) return sample;
        const cadence =
          typeof sample.windowId === "string"
            ? cadences.get(sample.windowId)
            : undefined;
        const hasCycle =
          cadence !== undefined ||
          sample.startedAt !== undefined ||
          sample.resetsAt !== undefined ||
          sample.durationMs !== undefined;
        return {
          type: "quota",
          metricId: sample.windowId,
          usedRatio: sample.usedRatio,
          ...(hasCycle
            ? {
                cycle: {
                  ...(cadence === undefined ? {} : { cadence }),
                  ...(sample.startedAt === undefined
                    ? {}
                    : { startedAt: sample.startedAt }),
                  ...(sample.resetsAt === undefined
                    ? {}
                    : { resetsAt: sample.resetsAt }),
                  ...(sample.durationMs === undefined
                    ? {}
                    : { durationMs: sample.durationMs }),
                },
              }
            : {}),
        };
      }),
    };
  });
}

/** Converts only the released 0.2.3/V4 storage wire shape into Task 2 input. */
function convertReleasedV4ProviderWire(
  stored: Record<string, unknown>,
  providerId: ProviderKind,
): ConvertedReleasedV4Wire {
  const snapshot = convertSnapshot(stored.snapshot, providerId);
  return {
    ...(snapshot === undefined ? {} : { snapshot }),
    history: convertHistory(stored.history, quotaCadences(snapshot)),
  };
}
