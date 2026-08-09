import type {
  ProviderId,
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
} from "../domain/model";
import type { ConnectableProviderId } from "../providers/registry";
import { refreshGrantedProviders } from "./refresh";

const PROVIDER_DEADLINE_MS = 20_000;

export interface RefreshPolicy {
  trigger: RefreshTrigger;
  interaction: "allowed" | "forbidden";
  bypassBackoff: boolean;
  deadlineMs: number;
}

export interface RefreshOrchestrator {
  refreshAll(trigger: "manual_all" | "scheduled"): Promise<RefreshReport>;
  refreshProvider(
    providerId: ConnectableProviderId,
    trigger: "connect" | "manual_provider",
  ): Promise<RefreshReport>;
  invalidateProvider(providerId: ConnectableProviderId): void;
  invalidateAll(): void;
}

export interface ProviderRunControl {
  generation: number;
  signal: AbortSignal;
  isCurrentGeneration(): boolean;
}

export interface RefreshOrchestratorDependencies {
  providerIds: readonly ConnectableProviderId[];
  hasPermission(providerId: ConnectableProviderId): Promise<boolean>;
  runProvider(
    providerId: ConnectableProviderId,
    policy: RefreshPolicy,
    control: ProviderRunControl,
  ): Promise<ProviderRefreshOutcome>;
  clock?: () => number;
}

interface ActiveRun {
  policy: RefreshPolicy;
  controller: AbortController;
  promise: Promise<ProviderRefreshOutcome>;
  followUp?: Promise<ProviderRefreshOutcome>;
}

export function deriveRefreshPolicy(trigger: RefreshTrigger): RefreshPolicy {
  if (trigger === "scheduled") {
    return {
      trigger,
      interaction: "forbidden",
      bypassBackoff: false,
      deadlineMs: PROVIDER_DEADLINE_MS,
    };
  }

  return {
    trigger,
    interaction: "allowed",
    bypassBackoff: true,
    deadlineMs: PROVIDER_DEADLINE_MS,
  };
}

function isStronger(candidate: RefreshPolicy, active: RefreshPolicy): boolean {
  return (
    candidate.interaction === "allowed" && active.interaction === "forbidden"
  );
}

function needsInteractiveFollowUp(outcome: ProviderRefreshOutcome): boolean {
  return (
    (outcome.kind === "deferred" && outcome.reason === "session_required") ||
    (outcome.kind === "failure" && outcome.category === "temporary_error")
  );
}

export function createRefreshOrchestrator(
  dependencies: RefreshOrchestratorDependencies,
): RefreshOrchestrator {
  const activeRuns = new Map<ProviderId, ActiveRun>();
  const generations = new Map<ProviderId, number>();
  const clock = dependencies.clock ?? Date.now;

  function startRun(
    providerId: ConnectableProviderId,
    policy: RefreshPolicy,
  ): Promise<ProviderRefreshOutcome> {
    const generation = (generations.get(providerId) ?? 0) + 1;
    generations.set(providerId, generation);
    const controller = new AbortController();

    const control: ProviderRunControl = {
      generation,
      signal: controller.signal,
      isCurrentGeneration: () => generations.get(providerId) === generation,
    };
    const active = { policy, controller } as ActiveRun;
    active.promise = Promise.resolve()
      .then(() => dependencies.runProvider(providerId, policy, control))
      .catch(
        (): ProviderRefreshOutcome => ({
          kind: "failure",
          category: "temporary_error",
        }),
      )
      .finally(() => {
        if (
          activeRuns.get(providerId) === active &&
          active.followUp === undefined
        ) {
          activeRuns.delete(providerId);
        }
      });
    activeRuns.set(providerId, active);
    return active.promise;
  }

  function requestProvider(
    providerId: ConnectableProviderId,
    policy: RefreshPolicy,
  ): Promise<ProviderRefreshOutcome> {
    const active = activeRuns.get(providerId);
    if (!active) {
      return startRun(providerId, policy);
    }

    if (!isStronger(policy, active.policy)) {
      return active.promise;
    }

    active.followUp ??= active.promise.then((outcome) => {
      if (needsInteractiveFollowUp(outcome)) {
        return startRun(providerId, policy);
      }

      if (activeRuns.get(providerId) === active) {
        activeRuns.delete(providerId);
      }
      return outcome;
    });
    return active.followUp;
  }

  function refresh(
    providerIds: readonly ConnectableProviderId[],
    trigger: RefreshTrigger,
  ): Promise<RefreshReport> {
    const policy = deriveRefreshPolicy(trigger);
    return refreshGrantedProviders(
      providerIds,
      dependencies.hasPermission,
      (providerId) => requestProvider(providerId, policy),
      trigger,
      clock,
    );
  }

  return {
    refreshAll(trigger) {
      return refresh(dependencies.providerIds, trigger);
    },
    refreshProvider(providerId, trigger) {
      return refresh([providerId], trigger);
    },
    invalidateProvider(providerId) {
      activeRuns.get(providerId)?.controller.abort();
      generations.set(providerId, (generations.get(providerId) ?? 0) + 1);
      activeRuns.delete(providerId);
    },
    invalidateAll() {
      activeRuns.forEach((active) => active.controller.abort());
      dependencies.providerIds.forEach((providerId) => {
        generations.set(providerId, (generations.get(providerId) ?? 0) + 1);
      });
      activeRuns.clear();
    },
  };
}
