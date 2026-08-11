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

async function writeState(state: AppState, now: number): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: migrateState(state, now) });
}

export async function loadState(
  now: number = Date.now(),
): Promise<AppState | undefined> {
  const stored = await browser.storage.local.get(STATE_KEY);
  const value = stored[STATE_KEY] as unknown;
  return value === undefined ? undefined : migrateState(value, now);
}

export function saveState(state: AppState, now: number): Promise<void> {
  return enqueueStateMutation(() => writeState(state, now));
}

async function ensureStateInsideMutation(now: number): Promise<AppState> {
  const stored = await browser.storage.local.get(STATE_KEY);
  const value = stored[STATE_KEY] as unknown;
  const state = migrateState(value, now);

  if (JSON.stringify(value) !== JSON.stringify(state)) {
    await writeState(state, now);
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
    await writeState(updater(state), now);
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
      if (granted === undefined) {
        return provider;
      }
      if (granted) {
        return { ...provider, access: "granted" };
      }
      if (
        provider.access === "granted" ||
        provider.history.length > 0 ||
        provider.snapshot !== undefined ||
        provider.lastAttempt !== undefined
      ) {
        return {
          providerId: provider.providerId,
          access: "required",
          history: [],
        };
      }

      return provider;
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

      return { providerId, access: "required", history: [] };
    }),
  }));
}

export function deleteAllLocalData(): Promise<AppState> {
  return enqueueStateMutation(async () => {
    const now = Date.now();
    await browser.storage.local.remove(STATE_KEY);
    const state = migrateState(undefined, now);
    await writeState(state, now);
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
