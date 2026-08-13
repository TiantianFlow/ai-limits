import {
  isApiKeyProviderId,
  type ApiKeyProviderId,
  type ProviderId,
} from "../providers/catalog";

const CREDENTIAL_STORAGE_KEY = "aiLimitsCredentials";
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

export type ConditionalCredentialSaveResult =
  | { saved: false }
  | {
      saved: true;
      previous: VersionedStoredApiKeyCredential | undefined;
      revision: string;
    };

interface CredentialStateV1 {
  version: 1;
  providers: Partial<Record<ApiKeyProviderId, VersionedStoredApiKeyCredential>>;
}

let credentialMutationQueue: Promise<void> = Promise.resolve();
let credentialStorageInitialized = false;

function enqueueCredentialMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = credentialMutationQueue.then(mutation);
  credentialMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function emptyCredentialState(): CredentialStateV1 {
  return { version: 1, providers: {} };
}

function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_API_KEY_LENGTH
    ? normalized
    : undefined;
}

function normalizeCredential(
  providerId: ApiKeyProviderId,
  value: unknown,
): VersionedStoredApiKeyCredential | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { kind?: unknown }).kind !== "api-key" ||
    !["active", "rejected"].includes((value as { status?: unknown }).status as string)
  ) {
    return undefined;
  }

  const apiKey = normalizeApiKey((value as { value?: unknown }).value);
  if (!apiKey) return undefined;

  return {
    kind: "api-key",
    value: apiKey,
    status: (value as { status: CredentialStatus }).status,
    revision:
      typeof (value as { revision?: unknown }).revision === "string" &&
      (value as { revision: string }).revision.length > 0
        ? (value as { revision: string }).revision
        : `legacy:${providerId}`,
  };
}

function normalizeCredentialState(value: unknown): CredentialStateV1 {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { providers?: unknown }).providers !== "object" ||
    (value as { providers?: unknown }).providers === null
  ) {
    return emptyCredentialState();
  }

  const storedProviders = (value as { providers: Record<string, unknown> }).providers;
  const providers: CredentialStateV1["providers"] = {};
  for (const [providerId, credential] of Object.entries(storedProviders)) {
    if (!isApiKeyProviderId(providerId)) continue;
    const normalizedCredential = normalizeCredential(providerId, credential);
    if (normalizedCredential) providers[providerId] = normalizedCredential;
  }

  return { version: 1, providers };
}

async function readCredentialState(): Promise<CredentialStateV1> {
  const stored = await browser.storage.local.get(CREDENTIAL_STORAGE_KEY);
  return normalizeCredentialState(stored[CREDENTIAL_STORAGE_KEY]);
}

async function writeCredentialState(state: CredentialStateV1): Promise<void> {
  await browser.storage.local.set({ [CREDENTIAL_STORAGE_KEY]: state });
}

function canUseCredentialStorage(): boolean {
  return credentialStorageInitialized;
}

export async function initializeCredentialStorage(): Promise<void> {
  credentialStorageInitialized = false;
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  credentialStorageInitialized = true;
}

export async function readProviderCredential(
  providerId: ProviderId,
): Promise<StoredApiKeyCredential | undefined> {
  const credential = await readProviderCredentialWithRevision(providerId);
  if (!credential) return undefined;
  const { revision: _revision, ...storedCredential } = credential;
  return storedCredential;
}

export async function readProviderCredentialWithRevision(
  providerId: ProviderId,
): Promise<VersionedStoredApiKeyCredential | undefined> {
  if (!canUseCredentialStorage() || !isApiKeyProviderId(providerId)) {
    return undefined;
  }

  return (await readCredentialState()).providers[providerId];
}

export function saveProviderApiKey(
  providerId: ApiKeyProviderId,
  value: string,
  status: CredentialStatus = "active",
): Promise<void> {
  return saveProviderApiKeyIfCurrent(
    providerId,
    value,
    () => true,
    status,
  ).then(() => undefined);
}

export function saveProviderApiKeyIfCurrent(
  providerId: ApiKeyProviderId,
  value: string,
  isCurrent: () => boolean,
  status: CredentialStatus = "active",
): Promise<ConditionalCredentialSaveResult> {
  const apiKey = normalizeApiKey(value);
  if (!canUseCredentialStorage() || !apiKey) {
    return Promise.resolve({ saved: false });
  }

  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    if (!isCurrent()) {
      return { saved: false } as const;
    }
    const previous = state.providers[providerId];
    const revision = globalThis.crypto.randomUUID();
    await writeCredentialState({
      ...state,
      providers: {
        ...state.providers,
        [providerId]: {
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

export function markProviderCredentialRejected(
  providerId: ApiKeyProviderId,
): Promise<void> {
  if (!canUseCredentialStorage()) return Promise.resolve();

  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const credential = state.providers[providerId];
    if (!credential) return;
    await writeCredentialState({
      ...state,
      providers: { ...state.providers, [providerId]: { ...credential, status: "rejected" } },
    });
  });
}

export function markProviderCredentialRejectedIfRevision(
  providerId: ApiKeyProviderId,
  expectedRevision: string,
): Promise<void> {
  if (!canUseCredentialStorage() || expectedRevision.length === 0) {
    return Promise.resolve();
  }

  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const credential = state.providers[providerId];
    if (
      credential?.status !== "active" ||
      credential.revision !== expectedRevision
    ) {
      return;
    }
    await writeCredentialState({
      ...state,
      providers: {
        ...state.providers,
        [providerId]: { ...credential, status: "rejected" },
      },
    });
  });
}

export function restoreProviderCredentialIfRevision(
  providerId: ApiKeyProviderId,
  expectedRevision: string,
  previous: VersionedStoredApiKeyCredential | undefined,
): Promise<boolean> {
  if (!canUseCredentialStorage() || expectedRevision.length === 0) {
    return Promise.resolve(false);
  }

  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const credential = state.providers[providerId];
    if (
      credential?.status !== "active" ||
      credential.revision !== expectedRevision
    ) {
      return false;
    }

    const providers = { ...state.providers };
    if (previous) {
      providers[providerId] = previous;
    } else {
      delete providers[providerId];
    }
    await writeCredentialState({ ...state, providers });
    return true;
  });
}

export function deleteProviderCredential(providerId: ProviderId): Promise<void> {
  if (!isApiKeyProviderId(providerId)) {
    return Promise.resolve();
  }
  if (!canUseCredentialStorage()) {
    return enqueueCredentialMutation(() =>
      browser.storage.local.remove(CREDENTIAL_STORAGE_KEY),
    );
  }

  return enqueueCredentialMutation(async () => {
    const state = await readCredentialState();
    const { [providerId]: _deletedCredential, ...providers } = state.providers;
    await writeCredentialState({ ...state, providers });
  });
}

export function deleteAllProviderCredentials(): Promise<void> {
  if (!canUseCredentialStorage()) {
    return enqueueCredentialMutation(() =>
      browser.storage.local.remove(CREDENTIAL_STORAGE_KEY),
    );
  }

  return enqueueCredentialMutation(() => writeCredentialState(emptyCredentialState()));
}
