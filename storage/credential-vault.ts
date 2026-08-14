import {
  isConnectionRevision,
  isProviderInstanceId,
  type ProviderInstanceId,
} from "../domain/instances";
import { isApiKeyProviderId } from "../providers/catalog";

export const CREDENTIAL_STORAGE_KEY = "aiLimitsCredentials";
const MAX_API_KEY_LENGTH = 4_096;

export type CredentialStatus = "active" | "rejected";

export interface StoredApiKeyCredential {
  kind: "api-key";
  value: string;
  status: CredentialStatus;
}

export interface VersionedStoredApiKeyCredential
  extends StoredApiKeyCredential {
  revision: string;
}

export interface CredentialStateV2 {
  version: 2;
  credentials: Record<ProviderInstanceId, VersionedStoredApiKeyCredential>;
}

export type ConditionalCredentialSaveResult =
  | { saved: false }
  | {
      saved: true;
      previous: VersionedStoredApiKeyCredential | undefined;
      revision: string;
    };

let credentialMutationQueue: Promise<void> = Promise.resolve();
let credentialStorageInitialized = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_API_KEY_LENGTH
    ? normalized
    : undefined;
}

function normalizeCredential(
  value: unknown,
): VersionedStoredApiKeyCredential | undefined {
  if (
    !isRecord(value) ||
    value.kind !== "api-key" ||
    (value.status !== "active" && value.status !== "rejected") ||
    !isConnectionRevision(value.revision)
  ) {
    return undefined;
  }
  const apiKey = normalizeApiKey(value.value);
  if (!apiKey) return undefined;
  return {
    kind: "api-key",
    value: apiKey,
    status: value.status,
    revision: value.revision,
  };
}

function isApiKeyInstanceId(value: unknown): value is ProviderInstanceId {
  return (
    isProviderInstanceId(value) &&
    isApiKeyProviderId(value.slice(0, value.indexOf(":")))
  );
}

export function emptyCredentialStateV2(): CredentialStateV2 {
  return { version: 2, credentials: {} };
}

export function normalizeCredentialStateV2(value: unknown): CredentialStateV2 {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    !isRecord(value.credentials)
  ) {
    return emptyCredentialStateV2();
  }
  const credentials: CredentialStateV2["credentials"] = {};
  for (const [instanceId, candidate] of Object.entries(value.credentials)) {
    if (!isApiKeyInstanceId(instanceId)) continue;
    const credential = normalizeCredential(candidate);
    if (credential) credentials[instanceId] = credential;
  }
  return { version: 2, credentials };
}

function enqueueCredentialMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = credentialMutationQueue.then(mutation);
  credentialMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readCredentialState(): Promise<CredentialStateV2> {
  const stored = await browser.storage.local.get(CREDENTIAL_STORAGE_KEY);
  return normalizeCredentialStateV2(stored[CREDENTIAL_STORAGE_KEY]);
}

async function writeCredentialState(state: CredentialStateV2): Promise<void> {
  await browser.storage.local.set({
    [CREDENTIAL_STORAGE_KEY]: normalizeCredentialStateV2(state),
  });
}

export async function initializeCredentialVault(): Promise<void> {
  credentialStorageInitialized = false;
  await browser.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  credentialStorageInitialized = true;
}

export async function readCredential(
  instanceId: ProviderInstanceId,
): Promise<StoredApiKeyCredential | undefined> {
  const credential = await readCredentialWithRevision(instanceId);
  if (!credential) return undefined;
  const { revision: _revision, ...storedCredential } = credential;
  return storedCredential;
}

export async function readCredentialWithRevision(
  instanceId: ProviderInstanceId,
): Promise<VersionedStoredApiKeyCredential | undefined> {
  if (!credentialStorageInitialized || !isApiKeyInstanceId(instanceId)) {
    return undefined;
  }
  return (await readCredentialState()).credentials[instanceId];
}

export function saveApiKeyIfCurrent(
  instanceId: ProviderInstanceId,
  value: string,
  isCurrent: () => boolean,
  status: CredentialStatus = "active",
): Promise<ConditionalCredentialSaveResult> {
  const apiKey = normalizeApiKey(value);
  if (
    !credentialStorageInitialized ||
    !isApiKeyInstanceId(instanceId) ||
    !apiKey ||
    (status !== "active" && status !== "rejected")
  ) {
    return Promise.resolve({ saved: false });
  }
  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    if (!isCurrent()) return { saved: false } as const;
    const previous = state.credentials[instanceId];
    const revision = globalThis.crypto.randomUUID();
    await writeCredentialState({
      ...state,
      credentials: {
        ...state.credentials,
        [instanceId]: {
          kind: "api-key",
          value: apiKey,
          status,
          revision,
        },
      },
    });
    return { saved: true, previous, revision } as const;
  });
}

export function markCredentialRejectedIfRevision(
  instanceId: ProviderInstanceId,
  expectedRevision: string,
): Promise<void> {
  if (
    !credentialStorageInitialized ||
    !isApiKeyInstanceId(instanceId) ||
    expectedRevision.length === 0
  ) {
    return Promise.resolve();
  }
  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const credential = state.credentials[instanceId];
    if (
      credential?.status !== "active" ||
      credential.revision !== expectedRevision
    ) {
      return;
    }
    await writeCredentialState({
      ...state,
      credentials: {
        ...state.credentials,
        [instanceId]: { ...credential, status: "rejected" },
      },
    });
  });
}

export function restoreCredentialIfRevision(
  instanceId: ProviderInstanceId,
  expectedRevision: string,
  previous: VersionedStoredApiKeyCredential | undefined,
): Promise<boolean> {
  if (
    !credentialStorageInitialized ||
    !isApiKeyInstanceId(instanceId) ||
    expectedRevision.length === 0
  ) {
    return Promise.resolve(false);
  }
  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const credential = state.credentials[instanceId];
    if (
      credential?.status !== "active" ||
      credential.revision !== expectedRevision
    ) {
      return false;
    }
    const credentials = { ...state.credentials };
    const normalizedPrevious = normalizeCredential(previous);
    if (normalizedPrevious) {
      credentials[instanceId] = normalizedPrevious;
    } else {
      delete credentials[instanceId];
    }
    await writeCredentialState({ ...state, credentials });
    return true;
  });
}

export function deleteCredential(
  instanceId: ProviderInstanceId,
): Promise<void> {
  if (!isApiKeyInstanceId(instanceId)) return Promise.resolve();
  if (!credentialStorageInitialized) {
    return Promise.reject(new Error("Credential storage is unavailable."));
  }
  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const credentials = { ...state.credentials };
    delete credentials[instanceId];
    await writeCredentialState({ ...state, credentials });
  });
}

export function deleteAllCredentials(): Promise<void> {
  if (!credentialStorageInitialized) {
    return enqueueCredentialMutation(() =>
      browser.storage.local.remove(CREDENTIAL_STORAGE_KEY),
    );
  }
  return enqueueCredentialMutation(() =>
    writeCredentialState(emptyCredentialStateV2()),
  );
}
