import type { AppState, DisplayMode, ProviderId, ProviderRecord } from "../domain/model";
import { migrateState } from "../providers/initial-state";

const STATE_KEY = "aiLimitsState";

export async function loadState(): Promise<AppState | undefined> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] as AppState | undefined;
}

export async function saveState(state: AppState): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

export async function ensureState(now: number): Promise<AppState> {
  void now;
  const stored = await browser.storage.local.get(STATE_KEY);
  const value = stored[STATE_KEY] as unknown;
  const state = migrateState(value);

  if (JSON.stringify(value) !== JSON.stringify(state)) {
    await saveState(state);
  }

  return state;
}

export async function setDisplayMode(mode: DisplayMode): Promise<void> {
  const state = await loadState();

  if (!state) {
    throw new Error("Cannot set display mode before state is initialized.");
  }

  await saveState({
    ...state,
    preferences: { ...state.preferences, displayMode: mode },
  });
}

export async function updateProvider(
  providerId: ProviderId,
  updater: (provider: ProviderRecord) => ProviderRecord,
): Promise<void> {
  const state = await loadState();

  if (!state) {
    throw new Error("Cannot update a provider before state is initialized.");
  }

  await saveState({
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
  });
}
