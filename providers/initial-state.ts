import { sanitizedFailureMessage } from "../domain/model";
import { observationFromUsage, retainUsageHistory } from "../domain/history";
import type {
  AppState,
  DisplayMode,
  MetricCycle,
  MetricHistorySample,
  MetricSegment,
  ProviderAttempt,
  ProviderId,
  ProviderRecord,
  UsageGroup,
  UsageHistoryObservation,
  UsageMetric,
  UsageSnapshot,
} from "../domain/model";
import { providerIds } from "./catalog";

export const CURRENT_STATE_VERSION = 4 as const;
const SEGMENT_SUM_TOLERANCE = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalNumber(
  value: unknown,
  predicate: (value: number) => boolean,
): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && predicate(value));
}

function normalizeCycle(value: unknown): MetricCycle | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    (value.cadence !== undefined && value.cadence !== "rolling" && value.cadence !== "calendar") ||
    !isOptionalNumber(value.startedAt, (number) => number >= 0) ||
    !isOptionalNumber(value.resetsAt, (number) => number >= 0) ||
    !isOptionalNumber(value.durationMs, (number) => number > 0) ||
    (isFiniteNumber(value.startedAt) &&
      isFiniteNumber(value.resetsAt) &&
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

function normalizeSegments(
  value: unknown,
  totalUsedRatio: number,
): MetricSegment[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const segments = value.map((segment): MetricSegment | undefined => {
    if (
      !isRecord(segment) ||
      !isNonEmptyString(segment.id) ||
      !isNonEmptyString(segment.label) ||
      !isFiniteNumber(segment.usedRatio) ||
      segment.usedRatio < 0 ||
      segment.usedRatio > 1
    ) {
      return undefined;
    }

    return {
      id: segment.id,
      label: segment.label,
      usedRatio: segment.usedRatio,
    };
  });

  if (
    segments.some((segment) => segment === undefined) ||
    new Set(segments.map((segment) => segment?.id)).size !== segments.length
  ) {
    return undefined;
  }

  const sum = (segments as MetricSegment[]).reduce(
    (total, segment) => total + segment.usedRatio,
    0,
  );
  return Math.abs(sum - totalUsedRatio) <= SEGMENT_SUM_TOLERANCE
    ? (segments as MetricSegment[])
    : undefined;
}

function normalizeMetric(value: unknown): UsageMetric | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !["general", "model", "feature", "product"].includes(value.scope as string)
  ) {
    return undefined;
  }

  const cycle = normalizeCycle(value.cycle);
  if (value.cycle !== undefined && cycle === undefined) return undefined;
  const base = {
    id: value.id,
    label: value.label,
    scope: value.scope as UsageMetric["scope"],
    ...(cycle === undefined ? {} : { cycle }),
  };

  if (value.type === "quota") {
    if (
      !isFiniteNumber(value.usedRatio) || value.usedRatio < 0 || value.usedRatio > 1 ||
      !isOptionalNumber(value.used, (number) => number >= 0) ||
      !isOptionalNumber(value.limit, (number) => number > 0) ||
      !isOptionalString(value.unit) ||
      (isFiniteNumber(value.used) && isFiniteNumber(value.limit) && value.used > value.limit)
    ) return undefined;
    const segments = normalizeSegments(value.segments, value.usedRatio);
    if (value.segments !== undefined && segments === undefined) return undefined;
    return {
      ...base,
      type: "quota",
      usedRatio: value.usedRatio,
      ...(value.used === undefined ? {} : { used: value.used }),
      ...(value.limit === undefined ? {} : { limit: value.limit }),
      ...(value.unit === undefined ? {} : { unit: value.unit }),
      ...(segments === undefined ? {} : { segments }),
    };
  }

  if (value.type === "counter") {
    if (
      (value.semantic !== "consumed" && value.semantic !== "spent") ||
      !isFiniteNumber(value.value) || value.value < 0 ||
      !isNonEmptyString(value.unit) ||
      !isOptionalNumber(value.limit, (number) => number > 0)
    ) return undefined;
    return {
      ...base,
      type: "counter",
      semantic: value.semantic,
      value: value.value,
      unit: value.unit,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
    };
  }

  if (
    value.type === "balance" &&
    isFiniteNumber(value.value) && value.value >= 0 &&
    isNonEmptyString(value.unit) &&
    isOptionalNumber(value.initialLimit, (number) => number > 0)
  ) {
    return {
      ...base,
      type: "balance",
      value: value.value,
      unit: value.unit,
      ...(value.initialLimit === undefined ? {} : { initialLimit: value.initialLimit }),
    };
  }
  return undefined;
}

function normalizeUsageGroups(
  value: unknown,
  metrics: readonly UsageMetric[],
): UsageGroup[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const groups = value.map((group): UsageGroup | undefined => {
    if (
      !isRecord(group) ||
      !isNonEmptyString(group.id) ||
      !isNonEmptyString(group.label) ||
      !isOptionalString(group.description) ||
      !Array.isArray(group.metricIds) ||
      !group.metricIds.every(isNonEmptyString) ||
      group.metricIds.length === 0
    ) {
      return undefined;
    }

    return {
      id: group.id,
      label: group.label,
      ...(group.description === undefined ? {} : { description: group.description }),
      metricIds: group.metricIds,
    };
  });

  if (
    groups.some((group) => group === undefined) ||
    new Set(groups.map((group) => group?.id)).size !== groups.length
  ) {
    return undefined;
  }

  const metricIds = new Set(metrics.map((metric) => metric.id));
  const memberships = (groups as UsageGroup[]).flatMap((group) => group.metricIds);

  if (
    memberships.some((membership) => !metricIds.has(membership)) ||
    new Set(memberships).size !== memberships.length ||
    memberships.length !== metricIds.size
  ) {
    return undefined;
  }

  return groups as UsageGroup[];
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeUsageSnapshot(
  value: unknown,
  providerId: ProviderId,
): UsageSnapshot | undefined {
  if (
    !isRecord(value) ||
    value.providerKind !== providerId ||
    (value.source !== "web-session" &&
      value.source !== "oauth" &&
      value.source !== "api-key" &&
      value.source !== "fixture") ||
    !isFiniteNumber(value.fetchedAt) ||
    value.fetchedAt < 0 ||
    !isOptionalString(value.accountLabel) ||
    !isOptionalString(value.planLabel) ||
    !Array.isArray(value.metrics) ||
    value.metrics.length === 0
  ) {
    return undefined;
  }

  const metrics = value.metrics.map(normalizeMetric);
  if (
    metrics.some((metric) => metric === undefined) ||
    new Set(metrics.map((metric) => metric?.id)).size !== metrics.length
  ) {
    return undefined;
  }

  const usageGroups = normalizeUsageGroups(
    value.usageGroups,
    metrics as UsageMetric[],
  );
  if (value.usageGroups !== undefined && usageGroups === undefined) return undefined;

  return {
    providerKind: providerId,
    ...(value.accountLabel !== undefined && !looksLikeEmail(value.accountLabel)
      ? { accountLabel: value.accountLabel }
      : {}),
    ...(value.planLabel !== undefined ? { planLabel: value.planLabel } : {}),
    source: value.source,
    fetchedAt: value.fetchedAt,
    metrics: metrics as UsageMetric[],
    ...(usageGroups === undefined ? {} : { usageGroups }),
  };
}

function normalizeHistorySample(value: unknown): MetricHistorySample | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.metricId)
  ) {
    return undefined;
  }
  const cycle = normalizeCycle(value.cycle);
  if (value.cycle !== undefined && cycle === undefined) return undefined;
  if (value.type === "quota" && isFiniteNumber(value.usedRatio) && value.usedRatio >= 0 && value.usedRatio <= 1) {
    return { type: "quota", metricId: value.metricId, usedRatio: value.usedRatio, ...(cycle ? { cycle } : {}) };
  }
  if (
    value.type === "counter" &&
    (value.semantic === "consumed" || value.semantic === "spent") &&
    isFiniteNumber(value.value) && value.value >= 0 &&
    isNonEmptyString(value.unit) &&
    isOptionalNumber(value.limit, (number) => number > 0)
  ) {
    return {
      type: "counter", metricId: value.metricId, semantic: value.semantic,
      value: value.value, unit: value.unit,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
      ...(cycle ? { cycle } : {}),
    };
  }
  if (
    value.type === "balance" && isFiniteNumber(value.value) && value.value >= 0 &&
    isNonEmptyString(value.unit) &&
    isOptionalNumber(value.initialLimit, (number) => number > 0)
  ) {
    return {
      type: "balance", metricId: value.metricId, value: value.value, unit: value.unit,
      ...(value.initialLimit === undefined ? {} : { initialLimit: value.initialLimit }),
      ...(cycle ? { cycle } : {}),
    };
  }
  return undefined;
}

function normalizeHistoryObservation(
  value: unknown,
): UsageHistoryObservation | undefined {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.observedAt) ||
    value.observedAt < 0 ||
    !Array.isArray(value.metrics)
  ) {
    return undefined;
  }

  const metrics = value.metrics.map(normalizeHistorySample);
  if (
    metrics.some((metric) => metric === undefined) ||
    new Set(metrics.map((metric) => metric?.metricId)).size !== metrics.length
  ) {
    return undefined;
  }

  return {
    observedAt: value.observedAt,
    metrics: metrics as MetricHistorySample[],
  };
}

function normalizeHistory(value: unknown): UsageHistoryObservation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byTimestamp = new Map<number, UsageHistoryObservation>();
  for (const candidate of value) {
    const observation = normalizeHistoryObservation(candidate);
    if (observation) {
      byTimestamp.set(observation.observedAt, observation);
    }
  }

  return [...byTimestamp.values()].sort(
    (left, right) => left.observedAt - right.observedAt,
  );
}

function normalizeAttemptOutcome(
  value: unknown,
): ProviderAttempt["outcome"] | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "success") {
    return { kind: "success" };
  }

  if (
    value.kind === "deferred" &&
    (value.reason === "session_required" || value.reason === "backoff") &&
    isOptionalNumber(value.retryAt, (number) => number >= 0)
  ) {
    return {
      kind: "deferred",
      reason: value.reason,
      ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
    };
  }

  if (
    value.kind === "failure" &&
    [
      "signed_out",
      "credential_invalid",
      "credential_scope_required",
      "challenge_blocked",
      "provider_changed",
      "temporary_error",
    ].includes(value.category as string) &&
    isOptionalString(value.message) &&
    isOptionalNumber(value.retryAt, (number) => number >= 0)
  ) {
    return {
      kind: "failure",
      category: value.category as Extract<
        ProviderAttempt["outcome"],
        { kind: "failure" }
      >["category"],
      ...(value.message === undefined
        ? {}
        : {
            message: sanitizedFailureMessage(
              value.category as Extract<
                ProviderAttempt["outcome"],
                { kind: "failure" }
              >["category"],
              value.message,
            ),
          }),
      ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
    };
  }

  return undefined;
}

function normalizeAttempt(value: unknown): ProviderAttempt | undefined {
  if (
    !isRecord(value) ||
    !["connect", "manual_provider", "manual_all", "scheduled"].includes(
      value.trigger as string,
    ) ||
    !isFiniteNumber(value.startedAt) ||
    value.startedAt < 0 ||
    !isFiniteNumber(value.finishedAt) ||
    value.finishedAt < value.startedAt
  ) {
    return undefined;
  }

  const outcome = normalizeAttemptOutcome(value.outcome);
  if (!outcome) {
    return undefined;
  }

  return {
    trigger: value.trigger as ProviderAttempt["trigger"],
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    outcome,
  };
}

function displayMode(value: unknown): DisplayMode {
  if (
    isRecord(value) &&
    isRecord(value.preferences) &&
    (value.preferences.displayMode === "used" ||
      value.preferences.displayMode === "left")
  ) {
    return value.preferences.displayMode;
  }

  return "used";
}

function autoRefresh(value: unknown): boolean {
  return isRecord(value) &&
    value.version === CURRENT_STATE_VERSION &&
    isRecord(value.preferences) &&
    typeof value.preferences.autoRefresh === "boolean"
    ? value.preferences.autoRefresh
    : true;
}

function normalizedAccess(
  root: unknown,
  stored: Record<string, unknown>,
): ProviderRecord["access"] {
  if (
    isRecord(root) &&
    (root.version === 3 || root.version === CURRENT_STATE_VERSION)
  ) {
    return stored.access === "granted" ? "granted" : "required";
  }

  return isRecord(stored.health) && stored.health.kind === "permission_required"
    ? "required"
    : "granted";
}

export function createInitialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    preferences: { displayMode: "used", autoRefresh: true },
    providers: providerIds.map((providerId) => ({
      providerId,
      access: "required",
      history: [],
    })),
  };
}

export function migrateState(value: unknown, now: number): AppState {
  const storedProviders =
    isRecord(value) && Array.isArray(value.providers) ? value.providers : [];

  const providers: ProviderRecord[] = providerIds.map((providerId) => {
    const stored = storedProviders.find(
      (candidate) => isRecord(candidate) && candidate.providerId === providerId,
    );

    if (!isRecord(stored)) {
      return { providerId, access: "required", history: [] };
    }

    const snapshot = normalizeUsageSnapshot(stored.snapshot, providerId);
    const lastAttempt = normalizeAttempt(stored.lastAttempt);
    const history =
      isRecord(value) && value.version === CURRENT_STATE_VERSION
        ? retainUsageHistory(normalizeHistory(stored.history), now)
        : isRecord(value) && value.version === 3 && snapshot
          ? retainUsageHistory([observationFromUsage(snapshot)], now)
          : [];

    return {
      providerId,
      access: normalizedAccess(value, stored),
      history,
      ...(snapshot ? { snapshot } : {}),
      ...(lastAttempt ? { lastAttempt } : {}),
    };
  });

  return {
    version: CURRENT_STATE_VERSION,
    preferences: {
      displayMode: displayMode(value),
      autoRefresh: autoRefresh(value),
    },
    providers,
  };
}
