import type { AppState, ProviderHealth } from "../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../providers/types";
import { ensureState, saveState } from "../storage/repository";

function applyResult(
  state: AppState,
  adapter: ProviderAdapter,
  result: CollectionResult,
): AppState {
  const providers = state.providers.map((provider) => {
    if (provider.providerId !== adapter.id) {
      return provider;
    }

    if (!result.ok) {
      return { ...provider, health: result.health };
    }

    return {
      providerId: provider.providerId,
      health: { kind: "connected" } as const,
      snapshot: {
        ...result.snapshot,
        providerId: provider.providerId,
      },
    };
  });

  return {
    ...state,
    demoMode: providers.some(({ snapshot }) => snapshot?.source === "fixture"),
    providers,
  };
}

export async function setProviderHealth(
  providerId: ProviderAdapter["id"],
  health: ProviderHealth,
  now: number,
): Promise<void> {
  const state = await ensureState(now);
  await saveState({
    ...state,
    providers: state.providers.map((provider) =>
      provider.providerId === providerId ? { ...provider, health } : provider,
    ),
  });
}

export async function refreshProvider(
  adapter: ProviderAdapter,
  context: CollectionContext,
): Promise<void> {
  let result: CollectionResult;

  try {
    result = await adapter.collect(context);
  } catch {
    result = { ok: false, health: { kind: "temporary_error" } };
  }

  const state = await ensureState(context.now);
  await saveState(applyResult(state, adapter, result));
}
