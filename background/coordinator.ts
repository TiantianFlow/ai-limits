import type { AppState, ProviderHealth } from "../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../providers/types";
import { mutateState } from "../storage/repository";

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
    providers,
  };
}

export async function setProviderHealth(
  providerId: ProviderAdapter["id"],
  health: ProviderHealth,
  now: number,
): Promise<void> {
  await mutateState(now, (state) => ({
    ...state,
    providers: state.providers.map((provider) =>
      provider.providerId === providerId ? { ...provider, health } : provider,
    ),
  }));
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

  await mutateState(context.now, (state) => applyResult(state, adapter, result));
}
