import type { AppState, DisplayMode, ProviderId, ProviderRecord } from "../domain/model";
import { migrateState } from "../providers/initial-state";

const STATE_KEY = "aiLimitsState";
let stateMutationQueue: Promise<void> = Promise.resolve();

function enqueueStateMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = stateMutationQueue.then(mutation);
  stateMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function writeState(state: AppState): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: migrateState(state) });
}

export async function loadState(): Promise<AppState | undefined> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] as AppState | undefined;
}

export function saveState(state: AppState): Promise<void> {
  return enqueueStateMutation(() => writeState(state));
}

async function ensureStateInsideMutation(now: number): Promise<AppState> {
  void now;
  const stored = await browser.storage.local.get(STATE_KEY);
  const value = stored[STATE_KEY] as unknown;
  const state = migrateState(value);

  if (JSON.stringify(value) !== JSON.stringify(state)) {
    await writeState(state);
  }

  return state;
}

export function ensureState(now: number): Promise<AppState> {
  return enqueueStateMutation(() => ensureStateInsideMutation(now));
}

export function mutateState(
  now: number,
  updater: (state: AppState) => AppState,
): Promise<void> {
  return enqueueStateMutation(async () => {
    const state = await ensureStateInsideMutation(now);
    await writeState(updater(state));
  });
}

export function setDisplayMode(mode: DisplayMode): Promise<void> {
  return mutateState(Date.now(), (state) => ({
    ...state,
    preferences: { ...state.preferences, displayMode: mode },
  }));
}

export function setAutoRefresh(autoRefresh: boolean): Promise<void> {
  return mutateState(Date.now(), (state) => ({
    ...state,
    preferences: { ...state.preferences, autoRefresh },
  }));
}

export function reconcileProviderAccess(
  grants: Partial<Record<ProviderId, boolean>>,
): Promise<void> {
  return mutateState(Date.now(), (state) => ({
    ...state,
    providers: state.providers.map((provider) => {
      const granted = grants[provider.providerId];
      return granted === undefined
        ? provider
        : { ...provider, access: granted ? "granted" : "required" };
    }),
  }));
}

export function disconnectProviderData(providerId: ProviderId): Promise<void> {
  return mutateState(Date.now(), (state) => ({
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.providerId !== providerId) {
        return provider;
      }

      return { providerId, access: "required" };
    }),
  }));
}

export function deleteAllLocalData(): Promise<AppState> {
  return enqueueStateMutation(async () => {
    await browser.storage.local.remove(STATE_KEY);
    const state = migrateState(undefined);
    await writeState(state);
    return state;
  });
}

export function updateProvider(
  providerId: ProviderId,
  updater: (provider: ProviderRecord) => ProviderRecord,
): Promise<void> {
  return mutateState(Date.now(), (state) => ({
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.providerId !== providerId) {
        return provider;
      }

      const originalProviderId = provider.providerId;
      const updated = updater(provider);
      return {
        ...updated,
        providerId: originalProviderId,
        snapshot: updated.snapshot
          ? { ...updated.snapshot, providerId: originalProviderId }
          : undefined,
      };
    }),
  }));
}
