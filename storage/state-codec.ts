import { retainUsageHistory } from "../domain/history";
import {
  DETAIL_TABLE_MAX_TABLES,
  DETAIL_TABLE_ROW_CAP,
  sanitizedFailureMessage,
  type DetailTable,
  type MetricCycle,
  type MetricHistorySample,
  type MetricSegment,
  type ProviderAttempt,
  type UsageGroup,
  type UsageHistoryObservation,
  type UsageMetric,
  type UsageSnapshot,
} from "../domain/model";
import {
  isConnectionRevision,
  isProviderInstanceId,
  type InstanceAppState,
  type ProviderInstanceRecord,
} from "../domain/model";
import { isProviderKind, type ProviderKind } from "../providers/catalog";
import { providerRegistry } from "../providers/registry";

export const INSTANCE_STATE_VERSION = 5 as const;
const SEGMENT_SUM_TOLERANCE = 1e-6;

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

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || nonEmptyString(value);
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

function normalizeSegments(
  value: unknown,
  totalUsedRatio: number,
): MetricSegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const segments = value.map((segment): MetricSegment | undefined => {
    if (
      !isRecord(segment) ||
      !nonEmptyString(segment.id) ||
      !nonEmptyString(segment.label) ||
      !isFiniteNonNegative(segment.usedRatio) ||
      segment.usedRatio > 1
    ) {
      return undefined;
    }
    return { id: segment.id, label: segment.label, usedRatio: segment.usedRatio };
  });
  if (
    segments.some((segment) => segment === undefined) ||
    new Set(segments.map((segment) => segment?.id)).size !== segments.length
  ) {
    return undefined;
  }
  const normalized = segments as MetricSegment[];
  const sum = normalized.reduce((total, segment) => total + segment.usedRatio, 0);
  return Math.abs(sum - totalUsedRatio) <= SEGMENT_SUM_TOLERANCE
    ? normalized
    : undefined;
}

function normalizeMetric(value: unknown): UsageMetric | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.label) ||
    !["general", "model", "feature", "product"].includes(value.scope as string)
  ) {
    return undefined;
  }
  const cycle = normalizeCycle(value.cycle);
  if (value.cycle !== undefined && cycle === undefined) return undefined;
  if (value.observedAt !== undefined && !isFiniteNonNegative(value.observedAt)) {
    return undefined;
  }
  const base = {
    id: value.id,
    label: value.label,
    scope: value.scope as UsageMetric["scope"],
    ...(cycle === undefined ? {} : { cycle }),
    ...(value.observedAt === undefined ? {} : { observedAt: value.observedAt }),
  };
  if (value.type === "quota") {
    if (
      !isFiniteNonNegative(value.usedRatio) ||
      value.usedRatio > 1 ||
      !optionalNonNegative(value.used) ||
      (value.limit !== undefined &&
        (!isFiniteNonNegative(value.limit) || value.limit === 0)) ||
      !optionalString(value.unit) ||
      (typeof value.used === "number" &&
        typeof value.limit === "number" &&
        value.used > value.limit)
    ) {
      return undefined;
    }
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
      !isFiniteNonNegative(value.value) ||
      !nonEmptyString(value.unit) ||
      (value.limit !== undefined &&
        (!isFiniteNonNegative(value.limit) || value.limit === 0))
    ) {
      return undefined;
    }
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
    isFiniteNonNegative(value.value) &&
    nonEmptyString(value.unit) &&
    (value.initialLimit === undefined ||
      (isFiniteNonNegative(value.initialLimit) && value.initialLimit > 0))
  ) {
    return {
      ...base,
      type: "balance",
      value: value.value,
      unit: value.unit,
      ...(value.initialLimit === undefined
        ? {}
        : { initialLimit: value.initialLimit }),
    };
  }
  return undefined;
}

function normalizeUsageGroups(
  value: unknown,
  metrics: readonly UsageMetric[],
): UsageGroup[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const groups = value.map((group): UsageGroup | undefined => {
    if (
      !isRecord(group) ||
      !nonEmptyString(group.id) ||
      !nonEmptyString(group.label) ||
      !optionalString(group.description) ||
      !Array.isArray(group.metricIds) ||
      group.metricIds.length === 0 ||
      !group.metricIds.every(nonEmptyString)
    ) {
      return undefined;
    }
    return {
      id: group.id,
      label: group.label,
      ...(group.description === undefined
        ? {}
        : { description: group.description }),
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

const DETAIL_CELL_TYPES = new Set([
  "text",
  "tokens",
  "percent",
  "money",
  "timestamp",
]);

function normalizeDetailTable(value: unknown): DetailTable | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.labelKey) ||
    !isFiniteNonNegative(value.observedAt) ||
    !optionalNonNegative(value.expiresAt) ||
    (value.omittedRowCount !== undefined &&
      !(
        isFiniteNonNegative(value.omittedRowCount) &&
        Number.isInteger(value.omittedRowCount)
      )) ||
    !optionalString(value.description) ||
    !Array.isArray(value.columns) ||
    value.columns.length === 0 ||
    value.columns.length > 6 ||
    !Array.isArray(value.rows)
  ) {
    return undefined;
  }
  const columns = value.columns.flatMap((column) => {
    if (
      !isRecord(column) ||
      !nonEmptyString(column.key) ||
      !nonEmptyString(column.labelKey) ||
      !DETAIL_CELL_TYPES.has(column.type as string)
    ) {
      return [];
    }
    return [
      {
        key: column.key,
        labelKey: column.labelKey,
        type: column.type as DetailTable["columns"][number]["type"],
      },
    ];
  });
  if (
    columns.length !== value.columns.length ||
    new Set(columns.map((column) => column.key)).size !== columns.length
  ) {
    return undefined;
  }
  const columnKeys = new Set(columns.map((column) => column.key));
  const normalizedRows = value.rows.flatMap((row) => {
    if (
      !isRecord(row) ||
      !nonEmptyString(row.id) ||
      !optionalString(row.badgeKey) ||
      !isRecord(row.cells)
    ) {
      return [];
    }
    const cells: Record<string, string | number> = {};
    for (const [key, cell] of Object.entries(row.cells)) {
      if (!columnKeys.has(key)) return [];
      if (typeof cell === "number" && Number.isFinite(cell)) {
        cells[key] = cell;
        continue;
      }
      if (typeof cell === "string" && cell.trim().length > 0 && cell.length <= 128) {
        cells[key] = cell;
        continue;
      }
      return [];
    }
    return [
      {
        id: row.id,
        cells,
        ...(row.badgeKey === undefined ? {} : { badgeKey: row.badgeKey }),
      },
    ];
  });
  if (normalizedRows.length !== value.rows.length) return undefined;
  const omittedFromCap = Math.max(0, normalizedRows.length - DETAIL_TABLE_ROW_CAP);
  const omittedRowCount =
    (typeof value.omittedRowCount === "number" ? value.omittedRowCount : 0) +
    omittedFromCap;
  return {
    id: value.id,
    labelKey: value.labelKey,
    columns,
    rows: normalizedRows.slice(0, DETAIL_TABLE_ROW_CAP),
    observedAt: value.observedAt,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    ...(omittedRowCount > 0 ? { omittedRowCount } : {}),
    ...(value.description === undefined ? {} : { description: value.description }),
  };
}

function normalizeDetailTables(value: unknown): DetailTable[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return [];
  const tables = value.slice(0, DETAIL_TABLE_MAX_TABLES).map(normalizeDetailTable);
  if (
    tables.some((table) => table === undefined) ||
    new Set(tables.map((table) => table?.id)).size !== tables.length
  ) {
    return undefined;
  }
  return tables as DetailTable[];
}

export function normalizeUsageSnapshot(
  value: unknown,
  providerKind: ProviderKind,
): UsageSnapshot | undefined {
  if (
    !isRecord(value) ||
    value.providerKind !== providerKind ||
    !["web-session", "oauth", "api-key", "fixture"].includes(value.source as string) ||
    !isFiniteNonNegative(value.fetchedAt) ||
    !optionalString(value.accountLabel) ||
    !optionalString(value.planLabel) ||
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
  const detailTables = normalizeDetailTables(value.detailTables);
  if (value.detailTables !== undefined && detailTables === undefined) return undefined;
  return {
    providerKind,
    ...(value.accountLabel !== undefined && !looksLikeEmail(value.accountLabel)
      ? { accountLabel: value.accountLabel }
      : {}),
    ...(value.planLabel === undefined ? {} : { planLabel: value.planLabel }),
    source: value.source as UsageSnapshot["source"],
    fetchedAt: value.fetchedAt,
    metrics: metrics as UsageMetric[],
    ...(usageGroups === undefined ? {} : { usageGroups }),
    ...(detailTables !== undefined && detailTables.length > 0
      ? { detailTables }
      : {}),
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
    (value.guidance !== undefined && value.guidance !== "retry_session") ||
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
    ...(value.guidance === "retry_session"
      ? { guidance: "retry_session" as const }
      : {}),
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

function normalizeInstance(
  value: unknown,
  now: number,
): ProviderInstanceRecord | undefined {
  if (
    !isRecord(value) ||
    !isProviderInstanceId(value.id) ||
    !isProviderKind(value.providerKind) ||
    !value.id.startsWith(`${value.providerKind}:`) ||
    (value.access !== "required" && value.access !== "granted") ||
    !isFiniteNonNegative(value.createdAt)
  ) {
    return undefined;
  }
  const config = providerRegistry[value.providerKind].normalizeConfig(value.config);
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
    ...(isConnectionRevision(value.connectionRevision)
      ? { connectionRevision: value.connectionRevision }
      : {}),
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
      (providerRegistry[instance.providerKind].cardinality === "single" &&
        singletonKinds.has(instance.providerKind))
    ) {
      continue;
    }
    instances.push(instance);
    instanceIds.add(instance.id);
    if (providerRegistry[instance.providerKind].cardinality === "single") {
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
