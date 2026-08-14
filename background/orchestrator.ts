import type { ProviderInstanceId } from "../domain/model";
import type {
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
} from "../domain/model";

const PROVIDER_DEADLINE_MS = 20_000;

export interface RefreshPolicy {
  trigger: RefreshTrigger;
  interaction: "allowed" | "forbidden";
  bypassBackoff: boolean;
  deadlineMs: number;
}

export interface RefreshOrchestrator {
  refreshAll(trigger: "manual_all" | "scheduled"): Promise<RefreshReport>;
  refreshInstance(
    instanceId: ProviderInstanceId,
    trigger: "connect" | "manual_provider",
  ): Promise<RefreshReport>;
  invalidateInstance(instanceId: ProviderInstanceId): void;
  invalidateAll(): void;
}

export interface ProviderRunControl {
  generation: number;
  signal: AbortSignal;
  isCurrentGeneration(): boolean;
}

export interface RefreshOrchestratorDependencies {
  listInstanceIds(): Promise<readonly ProviderInstanceId[]>;
  isAutoRefreshEnabled(): Promise<boolean>;
  isInstanceRefreshEligible(instanceId: ProviderInstanceId): Promise<boolean>;
  isScheduledRefreshEnabled?(
    instanceId: ProviderInstanceId,
  ): boolean | Promise<boolean>;
  getBackoffRetryAt(
    instanceId: ProviderInstanceId,
  ): Promise<number | undefined>;
  runProvider(
    instanceId: ProviderInstanceId,
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
  return candidate.interaction === "allowed" && active.interaction === "forbidden";
}

function needsInteractiveFollowUp(outcome: ProviderRefreshOutcome): boolean {
  return (
    (outcome.kind === "deferred" && outcome.reason === "session_required") ||
    (outcome.kind === "failure" && outcome.category === "temporary_error") ||
    (outcome.kind === "skipped" && outcome.reason === "auto_refresh_disabled")
  );
}

export function createRefreshOrchestrator(
  dependencies: RefreshOrchestratorDependencies,
): RefreshOrchestrator {
  const activeRuns = new Map<ProviderInstanceId, ActiveRun>();
  const generations = new Map<ProviderInstanceId, number>();
  const clock = dependencies.clock ?? Date.now;

  function runWithinDeadline(
    operation: () => Promise<ProviderRefreshOutcome>,
    controller: AbortController,
    deadlineMs: number,
  ): Promise<ProviderRefreshOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
      const finish = (outcome: ProviderRefreshOutcome) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () =>
        finish(
          timedOut
            ? { kind: "failure", category: "temporary_error" }
            : { kind: "skipped", reason: "superseded" },
        );
      timeout = globalThis.setTimeout(() => {
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
    instanceId: ProviderInstanceId,
    policy: RefreshPolicy,
  ): Promise<ProviderRefreshOutcome> {
    const generation = (generations.get(instanceId) ?? 0) + 1;
    generations.set(instanceId, generation);
    const controller = new AbortController();
    const control: ProviderRunControl = {
      generation,
      signal: controller.signal,
      isCurrentGeneration: () =>
        !controller.signal.aborted && generations.get(instanceId) === generation,
    };
    const active = { policy, controller, invalidated: false } as ActiveRun;
    active.promise = runWithinDeadline(
      async () => {
        if (!control.isCurrentGeneration()) {
          return { kind: "skipped", reason: "superseded" };
        }
        if (policy.trigger === "scheduled") {
          const enabled = await dependencies.isAutoRefreshEnabled();
          if (!control.isCurrentGeneration()) {
            return { kind: "skipped", reason: "superseded" };
          }
          if (!enabled) {
            return { kind: "skipped", reason: "auto_refresh_disabled" };
          }
        }
        const eligible = await dependencies.isInstanceRefreshEligible(instanceId);
        if (!control.isCurrentGeneration()) {
          return { kind: "skipped", reason: "superseded" };
        }
        if (!eligible) {
          return { kind: "skipped", reason: "permission_required" };
        }
        if (!policy.bypassBackoff) {
          const retryAt = await dependencies.getBackoffRetryAt(instanceId);
          if (!control.isCurrentGeneration()) {
            return { kind: "skipped", reason: "superseded" };
          }
          if (retryAt !== undefined && retryAt > clock()) {
            return { kind: "deferred", reason: "backoff", retryAt };
          }
        }
        return dependencies.runProvider(instanceId, policy, control);
      },
      controller,
      policy.deadlineMs,
    ).finally(() => {
      if (activeRuns.get(instanceId) === active && active.followUp === undefined) {
        activeRuns.delete(instanceId);
      }
    });
    activeRuns.set(instanceId, active);
    return active.promise;
  }

  function requestInstance(
    instanceId: ProviderInstanceId,
    policy: RefreshPolicy,
  ): Promise<ProviderRefreshOutcome> {
    const active = activeRuns.get(instanceId);
    if (!active) return startRun(instanceId, policy);
    if (!isStronger(policy, active.policy)) return active.promise;

    active.followUp ??= active.promise.then((outcome) => {
      if (active.invalidated || activeRuns.get(instanceId) !== active) {
        return { kind: "skipped", reason: "superseded" } as const;
      }
      if (needsInteractiveFollowUp(outcome)) return startRun(instanceId, policy);
      if (activeRuns.get(instanceId) === active) activeRuns.delete(instanceId);
      return outcome;
    });
    return active.followUp;
  }

  function refresh(
    instanceIds: readonly ProviderInstanceId[],
    trigger: RefreshTrigger,
  ): Promise<RefreshReport> {
    const policy = deriveRefreshPolicy(trigger);
    const startedAt = clock();
    return Promise.all(
      instanceIds.map(async (instanceId) => {
        try {
          return { instanceId, outcome: await requestInstance(instanceId, policy) };
        } catch {
          return {
            instanceId,
            outcome: { kind: "failure", category: "temporary_error" } as const,
          };
        }
      }),
    ).then((results) => ({
      trigger,
      startedAt,
      finishedAt: clock(),
      results,
    }));
  }

  return {
    async refreshAll(trigger) {
      let instanceIds = [...(await dependencies.listInstanceIds())];
      if (trigger === "scheduled" && dependencies.isScheduledRefreshEnabled) {
        const enabled = await Promise.all(
          instanceIds.map((instanceId) =>
            dependencies.isScheduledRefreshEnabled!(instanceId),
          ),
        );
        instanceIds = instanceIds.filter((_instanceId, index) => enabled[index]);
      }
      return refresh(instanceIds, trigger);
    },
    refreshInstance(instanceId, trigger) {
      return refresh([instanceId], trigger);
    },
    invalidateInstance(instanceId) {
      const active = activeRuns.get(instanceId);
      if (active) {
        active.invalidated = true;
        active.controller.abort();
      }
      generations.set(instanceId, (generations.get(instanceId) ?? 0) + 1);
      activeRuns.delete(instanceId);
    },
    invalidateAll() {
      for (const [instanceId, active] of activeRuns) {
        active.invalidated = true;
        active.controller.abort();
        generations.set(instanceId, (generations.get(instanceId) ?? 0) + 1);
      }
      activeRuns.clear();
    },
  };
}
