import type {
  ProviderId,
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
} from "../domain/model";
import type { ConnectableProviderId } from "../providers/registry";
import { providerCatalog } from "../providers/catalog";

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
  isAutoRefreshEnabled(): Promise<boolean>;
  isProviderRefreshEligible(
    providerId: ConnectableProviderId,
  ): Promise<boolean>;
  isScheduledRefreshEnabled?(providerId: ConnectableProviderId): boolean;
  getBackoffRetryAt(
    providerId: ConnectableProviderId,
  ): Promise<number | undefined>;
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
  invalidated: boolean;
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
    (outcome.kind === "failure" && outcome.category === "temporary_error") ||
    (outcome.kind === "skipped" &&
      outcome.reason === "auto_refresh_disabled")
  );
}

export function createRefreshOrchestrator(
  dependencies: RefreshOrchestratorDependencies,
): RefreshOrchestrator {
  const activeRuns = new Map<ProviderId, ActiveRun>();
  const generations = new Map<ProviderId, number>();
  const clock = dependencies.clock ?? Date.now;

  function runWithinDeadline(
    operation: () => Promise<ProviderRefreshOutcome>,
    controller: AbortController,
    deadlineMs: number,
  ): Promise<ProviderRefreshOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      const finish = (outcome: ProviderRefreshOutcome) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () =>
        finish(
          timedOut
            ? { kind: "failure", category: "temporary_error" }
            : { kind: "skipped", reason: "superseded" },
        );
      const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, deadlineMs);

      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) {
        onAbort();
        return;
      }

      let result: Promise<ProviderRefreshOutcome>;
      try {
        result = operation();
      } catch {
        finish({ kind: "failure", category: "temporary_error" });
        return;
      }
      void result.then(
        (outcome) => finish(outcome),
        () => finish({ kind: "failure", category: "temporary_error" }),
      );
    });
  }

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
      isCurrentGeneration: () =>
        !controller.signal.aborted &&
        generations.get(providerId) === generation,
    };
    const active = { policy, controller, invalidated: false } as ActiveRun;
    active.promise = runWithinDeadline(
      async () => {
        if (control.signal.aborted || !control.isCurrentGeneration()) {
          return { kind: "skipped", reason: "superseded" } as const;
        }

        if (policy.trigger === "scheduled") {
          const autoRefreshEnabled =
            await dependencies.isAutoRefreshEnabled();
          if (control.signal.aborted || !control.isCurrentGeneration()) {
            return { kind: "skipped", reason: "superseded" } as const;
          }

          if (!autoRefreshEnabled) {
            return {
              kind: "skipped",
              reason: "auto_refresh_disabled",
            } as const;
          }
        }

        const isRefreshEligible =
          await dependencies.isProviderRefreshEligible(providerId);
        if (control.signal.aborted || !control.isCurrentGeneration()) {
          return { kind: "skipped", reason: "superseded" } as const;
        }

        if (!isRefreshEligible) {
          return { kind: "skipped", reason: "permission_required" } as const;
        }

        if (!policy.bypassBackoff) {
          const retryAt = await dependencies.getBackoffRetryAt(providerId);
          if (control.signal.aborted || !control.isCurrentGeneration()) {
            return { kind: "skipped", reason: "superseded" } as const;
          }

          if (retryAt !== undefined && retryAt > clock()) {
            return {
              kind: "deferred",
              reason: "backoff",
              retryAt,
            } as const;
          }
        }

        return dependencies.runProvider(providerId, policy, control);
      },
      controller,
      policy.deadlineMs,
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
      if (
        active.invalidated ||
        activeRuns.get(providerId) !== active
      ) {
        return { kind: "skipped", reason: "superseded" } as const;
      }

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
    const startedAt = clock();
    const runs = providerIds.map((providerId) => {
      const run = requestProvider(providerId, policy);
      return run.then(
        (outcome) => [providerId, outcome] as const,
        () =>
          [
            providerId,
            { kind: "failure", category: "temporary_error" } as const,
          ] as const,
      );
    });

    return Promise.all(runs).then((results) => ({
      trigger,
      startedAt,
      finishedAt: clock(),
      providers: Object.fromEntries(results) as Partial<
        Record<ProviderId, ProviderRefreshOutcome>
      >,
    }));
  }

  return {
    refreshAll(trigger) {
      const providerIds =
        trigger === "scheduled"
          ? dependencies.providerIds.filter((providerId) =>
              (dependencies.isScheduledRefreshEnabled ??
                ((id: ConnectableProviderId) =>
                  providerCatalog[id].scheduledRefresh))(providerId),
            )
          : dependencies.providerIds;
      return refresh(providerIds, trigger);
    },
    refreshProvider(providerId, trigger) {
      return refresh([providerId], trigger);
    },
    invalidateProvider(providerId) {
      const active = activeRuns.get(providerId);
      if (active) {
        active.invalidated = true;
        active.controller.abort();
      }
      generations.set(providerId, (generations.get(providerId) ?? 0) + 1);
      activeRuns.delete(providerId);
    },
    invalidateAll() {
      activeRuns.forEach((active) => {
        active.invalidated = true;
        active.controller.abort();
      });
      dependencies.providerIds.forEach((providerId) => {
        generations.set(providerId, (generations.get(providerId) ?? 0) + 1);
      });
      activeRuns.clear();
    },
  };
}
