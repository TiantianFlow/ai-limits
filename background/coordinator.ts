import type {
  AppState,
  ProviderHealth,
  ProviderRefreshOutcome,
} from "../domain/model";
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
      snapshot: result.snapshot,
    };
  });

  return {
    ...state,
    providers,
  };
}

function normalizeResult(
  adapter: ProviderAdapter,
  result: CollectionResult,
): CollectionResult {
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    snapshot: {
      ...result.snapshot,
      providerId: adapter.id,
    },
  };
}

function refreshOutcome(result: CollectionResult): ProviderRefreshOutcome {
  if (result.ok) {
    return { kind: "success", snapshot: result.snapshot };
  }

  if (result.health.kind === "permission_required") {
    return { kind: "skipped", reason: "permission_required" };
  }

  if (
    result.health.kind === "connecting" ||
    result.health.kind === "connected"
  ) {
    return { kind: "failure", category: "temporary_error" };
  }

  const retryAt =
    result.health.kind === "temporary_error"
      ? result.health.retryAt
      : undefined;

  return {
    kind: "failure",
    category: result.health.kind,
    ...(result.health.message === undefined
      ? {}
      : { message: result.health.message }),
    ...(retryAt === undefined ? {} : { retryAt }),
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
  shouldCommit: () => boolean,
): Promise<ProviderRefreshOutcome> {
  let result: CollectionResult;

  try {
    result = await adapter.collect(context);
  } catch {
    result = { ok: false, health: { kind: "temporary_error" } };
  }

  const normalizedResult = normalizeResult(adapter, result);
  const outcome = refreshOutcome(normalizedResult);

  await mutateState(context.now, (state) =>
    shouldCommit() ? applyResult(state, adapter, normalizedResult) : state,
  );
  return outcome;
}
