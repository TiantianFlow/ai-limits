import { retainUsageHistory } from "../domain/history";
import {
  sanitizedFailureMessage,
  type MetricCycle,
  type MetricHistorySample,
  type ProviderAttempt,
  type UsageHistoryObservation,
} from "../domain/model";
import {
  isProviderInstanceId,
  type InstanceAppState,
  type ProviderInstanceConfig,
  type ProviderInstanceRecord,
} from "../domain/instances";
import { isProviderId, type ProviderKind } from "../providers/catalog";
import { normalizeUsageSnapshot } from "../providers/initial-state";
import { normalizeNewApiBaseUrl } from "../providers/newapi/url";

export const INSTANCE_STATE_VERSION = 5 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalNonNegative(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNonNegative(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeCycle(value: unknown): MetricCycle | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    (value.cadence !== undefined &&
      value.cadence !== "rolling" &&
      value.cadence !== "calendar") ||
    !optionalNonNegative(value.startedAt) ||
    !optionalNonNegative(value.resetsAt) ||
    (value.durationMs !== undefined &&
      (!isFiniteNonNegative(value.durationMs) || value.durationMs === 0)) ||
    (typeof value.startedAt === "number" &&
      typeof value.resetsAt === "number" &&
      value.resetsAt <= value.startedAt)
  ) {
    return undefined;
  }
  return {
    ...(value.cadence === undefined ? {} : { cadence: value.cadence }),
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
    ...(value.resetsAt === undefined ? {} : { resetsAt: value.resetsAt }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
  };
}

function normalizeHistorySample(value: unknown): MetricHistorySample | undefined {
  if (!isRecord(value) || !nonEmptyString(value.metricId)) return undefined;
  const cycle = normalizeCycle(value.cycle);
  if (value.cycle !== undefined && cycle === undefined) return undefined;
  if (
    value.type === "quota" &&
    typeof value.usedRatio === "number" &&
    Number.isFinite(value.usedRatio) &&
    value.usedRatio >= 0 &&
    value.usedRatio <= 1
  ) {
    return {
      type: "quota",
      metricId: value.metricId,
      usedRatio: value.usedRatio,
      ...(cycle === undefined ? {} : { cycle }),
    };
  }
  if (
    value.type === "counter" &&
    (value.semantic === "consumed" || value.semantic === "spent") &&
    isFiniteNonNegative(value.value) &&
    nonEmptyString(value.unit) &&
    (value.limit === undefined ||
      (isFiniteNonNegative(value.limit) && value.limit > 0))
  ) {
    return {
      type: "counter",
      metricId: value.metricId,
      semantic: value.semantic,
      value: value.value,
      unit: value.unit,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
      ...(cycle === undefined ? {} : { cycle }),
    };
  }
  if (
    value.type === "balance" &&
    isFiniteNonNegative(value.value) &&
    nonEmptyString(value.unit) &&
    (value.initialLimit === undefined ||
      (isFiniteNonNegative(value.initialLimit) && value.initialLimit > 0))
  ) {
    return {
      type: "balance",
      metricId: value.metricId,
      value: value.value,
      unit: value.unit,
      ...(value.initialLimit === undefined
        ? {}
        : { initialLimit: value.initialLimit }),
      ...(cycle === undefined ? {} : { cycle }),
    };
  }
  return undefined;
}

function normalizeHistory(
  value: unknown,
  now: number,
): UsageHistoryObservation[] {
  if (!Array.isArray(value)) return [];
  const observations: UsageHistoryObservation[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isFiniteNonNegative(candidate.observedAt) ||
      !Array.isArray(candidate.metrics) ||
      candidate.metrics.length === 0
    ) {
      continue;
    }
    const metrics = candidate.metrics.map(normalizeHistorySample);
    if (
      metrics.some((metric) => metric === undefined) ||
      new Set(metrics.map((metric) => metric?.metricId)).size !== metrics.length
    ) {
      continue;
    }
    observations.push({
      observedAt: candidate.observedAt,
      metrics: metrics as MetricHistorySample[],
    });
  }
  return retainUsageHistory(observations, now);
}

function normalizeAttemptOutcome(
  value: unknown,
): ProviderAttempt["outcome"] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "success") return { kind: "success" };
  if (
    value.kind === "deferred" &&
    (value.reason === "session_required" || value.reason === "backoff") &&
    optionalNonNegative(value.retryAt)
  ) {
    return {
      kind: "deferred",
      reason: value.reason,
      ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
    };
  }
  const categories = [
    "signed_out",
    "credential_invalid",
    "credential_scope_required",
    "challenge_blocked",
    "provider_changed",
    "temporary_error",
  ] as const;
  if (
    value.kind !== "failure" ||
    !categories.includes(value.category as (typeof categories)[number]) ||
    (value.message !== undefined && !nonEmptyString(value.message)) ||
    !optionalNonNegative(value.retryAt)
  ) {
    return undefined;
  }
  const category = value.category as (typeof categories)[number];
  return {
    kind: "failure",
    category,
    ...(value.message === undefined
      ? {}
      : { message: sanitizedFailureMessage(category, value.message) }),
    ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
  };
}

function normalizeAttempt(value: unknown): ProviderAttempt | undefined {
  if (
    !isRecord(value) ||
    !["connect", "manual_provider", "manual_all", "scheduled"].includes(
      value.trigger as string,
    ) ||
    !isFiniteNonNegative(value.startedAt) ||
    !isFiniteNonNegative(value.finishedAt) ||
    value.finishedAt < value.startedAt
  ) {
    return undefined;
  }
  const outcome = normalizeAttemptOutcome(value.outcome);
  if (!outcome) return undefined;
  return {
    trigger: value.trigger as ProviderAttempt["trigger"],
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    outcome,
  };
}

function normalizeConfig(
  providerKind: ProviderKind,
  value: unknown,
): ProviderInstanceConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (providerKind !== "newapi") {
    return value.kind === "fixed" ? { kind: "fixed" } : undefined;
  }
  if (value.kind !== "dynamic-origin") return undefined;
  const baseUrl = normalizeNewApiBaseUrl(value.baseUrl);
  return baseUrl ? { kind: "dynamic-origin", baseUrl } : undefined;
}

function normalizeInstance(
  value: unknown,
  now: number,
): ProviderInstanceRecord | undefined {
  if (
    !isRecord(value) ||
    !isProviderInstanceId(value.id) ||
    !isProviderId(value.providerKind) ||
    !value.id.startsWith(`${value.providerKind}:`) ||
    (value.access !== "required" && value.access !== "granted") ||
    !isFiniteNonNegative(value.createdAt)
  ) {
    return undefined;
  }
  const config = normalizeConfig(value.providerKind, value.config);
  if (!config) return undefined;
  const snapshot = normalizeUsageSnapshot(value.snapshot, value.providerKind);
  const lastAttempt = normalizeAttempt(value.lastAttempt);
  const userLabel =
    typeof value.userLabel === "string" &&
    value.userLabel.trim().length > 0 &&
    value.userLabel.trim().length <= 128
      ? value.userLabel.trim()
      : undefined;
  return {
    id: value.id,
    providerKind: value.providerKind,
    ...(userLabel === undefined ? {} : { userLabel }),
    config,
    access: value.access,
    createdAt: value.createdAt,
    history: normalizeHistory(value.history, now),
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(lastAttempt === undefined ? {} : { lastAttempt }),
  };
}

export function createEmptyInstanceAppState(): InstanceAppState {
  return {
    version: INSTANCE_STATE_VERSION,
    preferences: { displayMode: "used", autoRefresh: true },
    instances: [],
  };
}

export function normalizeInstanceAppState(
  value: unknown,
  now: number,
): InstanceAppState {
  if (!isRecord(value) || value.version !== INSTANCE_STATE_VERSION) {
    return createEmptyInstanceAppState();
  }
  const candidates = Array.isArray(value.instances) ? value.instances : [];
  const instances: ProviderInstanceRecord[] = [];
  const instanceIds = new Set<string>();
  const singletonKinds = new Set<ProviderKind>();
  for (const candidate of candidates) {
    const instance = normalizeInstance(candidate, now);
    if (
      !instance ||
      instanceIds.has(instance.id) ||
      (instance.providerKind !== "newapi" &&
        singletonKinds.has(instance.providerKind))
    ) {
      continue;
    }
    instances.push(instance);
    instanceIds.add(instance.id);
    if (instance.providerKind !== "newapi") {
      singletonKinds.add(instance.providerKind);
    }
  }
  const preferences = isRecord(value.preferences) ? value.preferences : {};
  return {
    version: INSTANCE_STATE_VERSION,
    preferences: {
      displayMode:
        preferences.displayMode === "left" ? "left" : "used",
      autoRefresh:
        typeof preferences.autoRefresh === "boolean"
          ? preferences.autoRefresh
          : true,
    },
    instances,
  };
}
