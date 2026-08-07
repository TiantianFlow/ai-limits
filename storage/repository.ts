import type { AppState, DisplayMode, ProviderId, ProviderRecord } from "../domain/model";
import { createFixtureState } from "../providers/fixtures";

const STATE_KEY = "aiLimitsState";

export async function loadState(): Promise<AppState | undefined> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] as AppState | undefined;
}

export async function saveState(state: AppState): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

export async function ensureState(now: number): Promise<AppState> {
  const state = await loadState();

  if (state) {
    return state;
  }

  const fixtures = createFixtureState(now);
  await saveState(fixtures);
  return fixtures;
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

      const updated = updater(provider);
      return {
        ...updated,
        providerId: provider.providerId,
        snapshot: updated.snapshot
          ? { ...updated.snapshot, providerId: provider.providerId }
          : undefined,
      };
    }),
  });
}
