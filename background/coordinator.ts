import { sanitizedFailureMessage } from "../domain/model";
import { appendQuotaObservation } from "../domain/history";
import type {
  AppState,
  ProviderAttempt,
  ProviderRefreshOutcome,
  RefreshTrigger,
} from "../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../providers/types";
import { normalizeProviderSnapshot } from "../providers/initial-state";
import {
  providerRegistry,
  type ConnectableProviderId,
} from "../providers/registry";
import { providerCatalog } from "../providers/catalog";
import { readProviderCredential } from "../storage/credentials";
import {
  disconnectProviderData,
  mutateState,
  reconcileProviderAccess,
} from "../storage/repository";
import {
  permissionChangeAffectsProvider,
  removeProviderPermission,
  type ProviderPermissionContext,
} from "./permissions";
import { isProviderConnected } from "./provider-access";

let permissionReconciliationGeneration = 0;
const DEFAULT_SCHEDULED_BACKOFF_MS = 15 * 60 * 1_000;

function normalizeResult(
  adapter: ProviderAdapter,
  result: CollectionResult,
  finishedAt: number,
): CollectionResult {
  if (!result.ok) {
    return result;
  }

  const snapshot = normalizeProviderSnapshot(
    {
      ...result.snapshot,
      providerId: adapter.id,
      fetchedAt: finishedAt,
    },
    adapter.id,
  );
  if (!snapshot) {
    return { ok: false, health: { kind: "provider_changed" } };
  }

  return {
    ok: true,
    snapshot,
  };
}

function refreshOutcome(result: CollectionResult): ProviderRefreshOutcome {
  if (result.ok) {
    return { kind: "success", snapshot: result.snapshot };
  }

  if ("deferred" in result) {
    return {
      kind: "deferred",
      reason: result.deferred.reason,
      ...(result.deferred.retryAt === undefined
        ? {}
        : { retryAt: result.deferred.retryAt }),
    };
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
      : {
          message: sanitizedFailureMessage(
            result.health.kind,
            result.health.message,
          ),
        }),
    ...(retryAt === undefined ? {} : { retryAt }),
  };
}

function withScheduledBackoff(
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  finishedAt: number,
): ProviderRefreshOutcome {
  if (
    trigger !== "scheduled" ||
    outcome.kind !== "failure" ||
    outcome.category !== "temporary_error" ||
    outcome.retryAt !== undefined
  ) {
    return outcome;
  }

  return {
    ...outcome,
    retryAt: finishedAt + DEFAULT_SCHEDULED_BACKOFF_MS,
  };
}

function providerAttempt(
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
  outcome: ProviderRefreshOutcome,
): ProviderAttempt | undefined {
  if (outcome.kind === "success") {
    return {
      trigger,
      startedAt,
      finishedAt,
      outcome: { kind: "success" },
    };
  }

  if (outcome.kind === "deferred") {
    return {
      trigger,
      startedAt,
      finishedAt,
      outcome: {
        kind: "deferred",
        reason: outcome.reason,
        ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
      },
    };
  }

  if (outcome.kind === "failure") {
    return {
      trigger,
      startedAt,
      finishedAt,
      outcome: {
        kind: "failure",
        category: outcome.category,
        ...(outcome.message === undefined ? {} : { message: outcome.message }),
        ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
      },
    };
  }

  return undefined;
}

function applyOutcome(
  state: AppState,
  adapter: ProviderAdapter,
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
): AppState {
  const providers = state.providers.map((provider) => {
    if (provider.providerId !== adapter.id) {
      return provider;
    }

    if (outcome.kind === "skipped") {
      return outcome.reason === "permission_required"
        ? { ...provider, access: "required" as const }
        : provider;
    }

    const lastAttempt = providerAttempt(
      trigger,
      startedAt,
      finishedAt,
      outcome,
    );
    if (!lastAttempt) {
      return provider;
    }

    return {
      ...provider,
      ...(outcome.kind === "success"
        ? {
            access: "granted" as const,
            snapshot: outcome.snapshot,
            history: appendQuotaObservation(
              provider.snapshot?.planLabel &&
                outcome.snapshot.planLabel &&
                provider.snapshot.planLabel !== outcome.snapshot.planLabel
                ? []
                : provider.history,
              outcome.snapshot,
            ),
          }
        : {}),
      lastAttempt,
    };
  });

  return { ...state, providers };
}

export interface CollectedProviderOutcome {
  outcome: ProviderRefreshOutcome;
  finishedAt: number;
}

export async function collectProviderOutcome(
  adapter: ProviderAdapter,
  context: CollectionContext,
  trigger: RefreshTrigger,
  clock: () => number = Date.now,
): Promise<CollectedProviderOutcome> {
  let result: CollectionResult;

  try {
    result = await adapter.collect(context);
  } catch {
    result = { ok: false, health: { kind: "temporary_error" } };
  }

  const finishedAt = Math.max(context.now, clock());
  return {
    outcome: withScheduledBackoff(
      refreshOutcome(normalizeResult(adapter, result, finishedAt)),
      trigger,
      finishedAt,
    ),
    finishedAt,
  };
}

export async function commitProviderOutcome(
  adapter: ProviderAdapter,
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
  shouldCommit: () => boolean,
): Promise<ProviderRefreshOutcome> {
  let committed = false;

  await mutateState(startedAt, (state) => {
    if (!shouldCommit()) {
      return state;
    }

    committed = true;
    return applyOutcome(
      state,
      adapter,
      outcome,
      trigger,
      startedAt,
      finishedAt,
    );
  });
  return committed ? outcome : { kind: "skipped", reason: "superseded" };
}

export async function refreshProvider(
  adapter: ProviderAdapter,
  context: CollectionContext,
  trigger: RefreshTrigger,
  shouldCommit: () => boolean,
  clock: () => number = Date.now,
): Promise<ProviderRefreshOutcome> {
  const { outcome, finishedAt } = await collectProviderOutcome(
    adapter,
    context,
    trigger,
    clock,
  );
  return commitProviderOutcome(
    adapter,
    outcome,
    trigger,
    context.now,
    finishedAt,
    shouldCommit,
  );
}

export async function reconcileProviderPermissions(
  providerIds: readonly ConnectableProviderId[],
): Promise<void> {
  const generation = ++permissionReconciliationGeneration;
  const access = await Promise.all(
    providerIds.map(async (providerId) => [
      providerId,
      await isProviderConnected(providerId),
    ] as const),
  );

  if (generation !== permissionReconciliationGeneration) {
    return;
  }
  await reconcileProviderAccess(Object.fromEntries(access));
}

export async function reconcileRemovedProviderPermissions(
  removed: Browser.permissions.Permissions,
  providerIds: readonly ConnectableProviderId[],
  invalidateProvider: (providerId: ConnectableProviderId) => void,
): Promise<void> {
  const affectedProviderIds = providerIds.filter((providerId) => {
    return permissionChangeAffectsProvider(providerId, removed);
  });
  affectedProviderIds.forEach(invalidateProvider);
  await Promise.all(
    affectedProviderIds.map((providerId) =>
      disconnectProviderData(providerId),
    ),
  );
  await reconcileProviderPermissions(providerIds);
}

export type DisconnectProviderResult =
  | { ok: true; localDataDeleted: true }
  | {
      ok: false;
      error: "permission_removal_failed";
      localDataDeleted: true;
    };

export async function disconnectProvider(
  providerId: ConnectableProviderId,
  remainingConnectedProviderIds: readonly ConnectableProviderId[],
  permissionContext?: ProviderPermissionContext,
): Promise<DisconnectProviderResult> {
  const storedCredential = permissionContext
    ? undefined
    : await readProviderCredential(providerId);
  await disconnectProviderData(providerId);

  let removed = false;
  try {
    removed = await removeProviderPermission(
      providerId,
      remainingConnectedProviderIds.filter(
        (remainingProviderId) => remainingProviderId !== providerId,
      ),
      providerCatalog,
      permissionContext ?? { baseUrl: storedCredential?.baseUrl },
    );
  } catch {
    // Local deletion above is authoritative even if Chrome permission cleanup fails.
  }

  if (!removed) {
    return {
      ok: false,
      error: "permission_removal_failed",
      localDataDeleted: true,
    };
  }

  return { ok: true, localDataDeleted: true };
}
