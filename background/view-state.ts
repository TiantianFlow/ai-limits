import type {
  InstanceAppState,
  ProviderInstanceId,
} from "../domain/instances";
import type {
  MetricCycle,
  MetricHistorySample,
  ProviderAttempt,
  UsageHistoryObservation,
  UsageMetric,
  UsageSnapshot,
} from "../domain/model";
import type { ProviderKind } from "../providers/catalog";

export interface ProviderInstanceView {
  id: ProviderInstanceId;
  providerKind: ProviderKind;
  userLabel?: string;
  origin?: string;
  access: "required" | "granted";
  createdAt: number;
  history: UsageHistoryObservation[];
  snapshot?: UsageSnapshot;
  lastAttempt?: ProviderAttempt;
}

export interface AppViewState {
  preferences: InstanceAppState["preferences"];
  instances: ProviderInstanceView[];
}

function projectCycle(cycle: MetricCycle | undefined): MetricCycle | undefined {
  if (!cycle) return undefined;
  return {
    ...(cycle.cadence === undefined ? {} : { cadence: cycle.cadence }),
    ...(cycle.startedAt === undefined ? {} : { startedAt: cycle.startedAt }),
    ...(cycle.resetsAt === undefined ? {} : { resetsAt: cycle.resetsAt }),
    ...(cycle.durationMs === undefined ? {} : { durationMs: cycle.durationMs }),
  };
}

function projectMetric(metric: UsageMetric): UsageMetric {
  const base = {
    type: metric.type,
    id: metric.id,
    label: metric.label,
    scope: metric.scope,
    ...(projectCycle(metric.cycle) ? { cycle: projectCycle(metric.cycle) } : {}),
  };
  if (metric.type === "quota") {
    return {
      ...base,
      type: "quota",
      usedRatio: metric.usedRatio,
      ...(metric.used === undefined ? {} : { used: metric.used }),
      ...(metric.limit === undefined ? {} : { limit: metric.limit }),
      ...(metric.unit === undefined ? {} : { unit: metric.unit }),
      ...(metric.segments === undefined
        ? {}
        : {
            segments: metric.segments.map((segment) => ({
              id: segment.id,
              label: segment.label,
              usedRatio: segment.usedRatio,
            })),
          }),
    };
  }
  if (metric.type === "counter") {
    return {
      ...base,
      type: "counter",
      semantic: metric.semantic,
      value: metric.value,
      unit: metric.unit,
      ...(metric.limit === undefined ? {} : { limit: metric.limit }),
    };
  }
  return {
    ...base,
    type: "balance",
    value: metric.value,
    unit: metric.unit,
    ...(metric.initialLimit === undefined
      ? {}
      : { initialLimit: metric.initialLimit }),
  };
}

function projectSnapshot(snapshot: UsageSnapshot): UsageSnapshot {
  return {
    providerKind: snapshot.providerKind,
    ...(snapshot.accountLabel === undefined
      ? {}
      : { accountLabel: snapshot.accountLabel }),
    ...(snapshot.planLabel === undefined ? {} : { planLabel: snapshot.planLabel }),
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    metrics: snapshot.metrics.map(projectMetric),
    ...(snapshot.usageGroups === undefined
      ? {}
      : {
          usageGroups: snapshot.usageGroups.map((group) => ({
            id: group.id,
            label: group.label,
            ...(group.description === undefined
              ? {}
              : { description: group.description }),
            metricIds: [...group.metricIds],
          })),
        }),
  };
}

function projectHistoryMetric(metric: MetricHistorySample): MetricHistorySample {
  const cycle = projectCycle(metric.cycle);
  if (metric.type === "quota") {
    return {
      type: "quota",
      metricId: metric.metricId,
      usedRatio: metric.usedRatio,
      ...(cycle ? { cycle } : {}),
    };
  }
  if (metric.type === "counter") {
    return {
      type: "counter",
      metricId: metric.metricId,
      semantic: metric.semantic,
      value: metric.value,
      unit: metric.unit,
      ...(metric.limit === undefined ? {} : { limit: metric.limit }),
      ...(cycle ? { cycle } : {}),
    };
  }
  return {
    type: "balance",
    metricId: metric.metricId,
    value: metric.value,
    unit: metric.unit,
    ...(metric.initialLimit === undefined
      ? {}
      : { initialLimit: metric.initialLimit }),
    ...(cycle ? { cycle } : {}),
  };
}

function projectHistory(
  history: readonly UsageHistoryObservation[],
): UsageHistoryObservation[] {
  return history.map((observation) => ({
    observedAt: observation.observedAt,
    metrics: observation.metrics.map(projectHistoryMetric),
  }));
}

function projectAttempt(attempt: ProviderAttempt): ProviderAttempt {
  const outcome = attempt.outcome;
  return {
    trigger: attempt.trigger,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    outcome:
      outcome.kind === "success"
        ? { kind: "success" }
        : outcome.kind === "deferred"
          ? {
              kind: "deferred",
              reason: outcome.reason,
              ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
            }
          : {
              kind: "failure",
              category: outcome.category,
              ...(outcome.message === undefined ? {} : { message: outcome.message }),
              ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
            },
  };
}

export function projectAppViewState(state: InstanceAppState): AppViewState {
  return {
    preferences: {
      displayMode: state.preferences.displayMode,
      autoRefresh: state.preferences.autoRefresh,
    },
    instances: state.instances.map((instance) => ({
      id: instance.id,
      providerKind: instance.providerKind,
      ...(instance.userLabel === undefined
        ? {}
        : { userLabel: instance.userLabel }),
      ...(instance.config.kind === "dynamic-origin"
        ? { origin: new URL(instance.config.baseUrl).origin }
        : {}),
      access: instance.access,
      createdAt: instance.createdAt,
      history: projectHistory(instance.history),
      ...(instance.snapshot === undefined
        ? {}
        : { snapshot: projectSnapshot(instance.snapshot) }),
      ...(instance.lastAttempt === undefined
        ? {}
        : { lastAttempt: projectAttempt(instance.lastAttempt) }),
    })),
  };
}
