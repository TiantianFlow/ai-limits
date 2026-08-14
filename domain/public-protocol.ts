import {
  isProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "./instances";
import type {
  DeferredReason,
  DisplayMode,
  FailureCategory,
  MetricCycle,
  MetricHistorySample,
  ProviderAttempt,
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
  UsageGroup,
  UsageHistoryObservation,
  UsageMetric,
  UsageSnapshot,
} from "./model";
import {
  isApiKeyProviderId,
  isProviderId,
  type ApiKeyProviderKind,
  type BrowserSessionProviderKind,
  type ProviderKind,
} from "../providers/catalog";
import { normalizeNewApiBaseUrl } from "../providers/newapi/url";

export type ApiKeyConnectionStatus =
  | "connected"
  | "invalid_key"
  | "insufficient_scope"
  | "invalid_site"
  | "temporary_error";

export type ProviderOperation =
  | "requesting_permission"
  | "fetching"
  | "waiting_for_session";

export interface ProviderOperationEvent {
  type: "PROVIDER_OPERATION";
  instanceId: ProviderInstanceId;
  operation: "waiting_for_session";
}

export interface ProviderInstanceView {
  id: ProviderInstanceId;
  providerKind: ProviderKind;
  userLabel?: string;
  baseUrl?: string;
  origin?: string;
  access: "required" | "granted";
  createdAt: number;
  history: UsageHistoryObservation[];
  snapshot?: UsageSnapshot;
  lastAttempt?: ProviderAttempt;
}

export interface AppViewState {
  preferences: {
    displayMode: DisplayMode;
    autoRefresh: boolean;
  };
  instances: ProviderInstanceView[];
}

export interface ConnectApiKeyProviderCommand {
  type: "CONNECT_API_KEY_PROVIDER";
  providerKind: ApiKeyProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
  apiKey: string;
  permissionIntentId: string;
}

export interface PrepareProviderPermissionCommand {
  type: "PREPARE_PROVIDER_PERMISSION";
  providerKind: ProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
}

export type RuntimeCommand =
  | { type: "REFRESH_ALL" }
  | {
      type: "CONNECT_BROWSER_PROVIDER";
      providerKind: BrowserSessionProviderKind;
      permissionIntentId: string;
    }
  | PrepareProviderPermissionCommand
  | {
      type: "RESOLVE_PROVIDER_PERMISSION";
      permissionIntentId: string;
      granted: boolean;
    }
  | { type: "ABANDON_PROVIDER_PERMISSION"; permissionIntentId: string }
  | ConnectApiKeyProviderCommand
  | { type: "REFRESH_INSTANCE"; instanceId: ProviderInstanceId }
  | {
      type: "RENAME_INSTANCE";
      instanceId: ProviderInstanceId;
      userLabel?: string;
    }
  | { type: "DISCONNECT_INSTANCE"; instanceId: ProviderInstanceId }
  | { type: "GET_STATE" }
  | { type: "SET_DISPLAY_MODE"; mode: DisplayMode }
  | { type: "SET_AUTO_REFRESH"; enabled: boolean }
  | { type: "DELETE_LOCAL_DATA" };

export interface RuntimeCommandFailure {
  ok: false;
  error: "command_failed";
}

export type DisconnectInstanceResult =
  | { ok: true; localDataDeleted: true }
  | {
      ok: false;
      error: "permission_removal_failed";
      localDataDeleted: true;
    };

export interface ConnectApiKeyProviderResult {
  report: RefreshReport;
  result: ApiKeyConnectionStatus;
}

export interface RefreshResponse {
  state: AppViewState;
  report: RefreshReport;
}

export interface DeleteResponse {
  state: AppViewState;
  result: "deleted" | "deleted_with_permission_errors";
}

export interface DisconnectResponse {
  state: AppViewState;
  result: DisconnectInstanceResult;
}

export interface ApiKeyConnectionResponse extends ConnectApiKeyProviderResult {
  state: AppViewState;
}

export interface PermissionIntentResponse {
  state: AppViewState;
  permissionIntentId: string;
  instanceId: ProviderInstanceId;
  permissions: Browser.permissions.Permissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeText(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isPermissionIntentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isMetricCycle(value: unknown): value is MetricCycle {
  return (
    hasExactKeys(value, [], ["cadence", "startedAt", "resetsAt", "durationMs"]) &&
    (value.cadence === undefined ||
      value.cadence === "rolling" ||
      value.cadence === "calendar") &&
    isOptionalFiniteNumber(value.startedAt) &&
    isOptionalFiniteNumber(value.resetsAt) &&
    isOptionalFiniteNumber(value.durationMs)
  );
}

function copyCycle(cycle: MetricCycle | undefined): MetricCycle | undefined {
  return cycle
    ? {
        ...(cycle.cadence === undefined ? {} : { cadence: cycle.cadence }),
        ...(cycle.startedAt === undefined ? {} : { startedAt: cycle.startedAt }),
        ...(cycle.resetsAt === undefined ? {} : { resetsAt: cycle.resetsAt }),
        ...(cycle.durationMs === undefined ? {} : { durationMs: cycle.durationMs }),
      }
    : undefined;
}

function isMetricSegment(value: unknown): boolean {
  return (
    hasExactKeys(value, ["id", "label", "usedRatio"]) &&
    isSafeText(value.id, 128) &&
    isSafeText(value.label) &&
    isFiniteNumber(value.usedRatio)
  );
}

function isUsageMetric(value: unknown): value is UsageMetric {
  if (!isRecord(value)) return false;
  const commonValid =
    isSafeText(value.id, 128) &&
    isSafeText(value.label) &&
    (value.scope === "general" ||
      value.scope === "model" ||
      value.scope === "feature" ||
      value.scope === "product") &&
    (value.cycle === undefined || isMetricCycle(value.cycle));
  if (!commonValid) return false;
  if (value.type === "quota") {
    return (
      hasExactKeys(
        value,
        ["type", "id", "label", "scope", "usedRatio"],
        ["cycle", "used", "limit", "unit", "segments"],
      ) &&
      isFiniteNumber(value.usedRatio) &&
      isOptionalFiniteNumber(value.used) &&
      isOptionalFiniteNumber(value.limit) &&
      (value.unit === undefined || isSafeText(value.unit, 128)) &&
      (value.segments === undefined ||
        (Array.isArray(value.segments) && value.segments.every(isMetricSegment)))
    );
  }
  if (value.type === "counter") {
    return (
      hasExactKeys(
        value,
        ["type", "id", "label", "scope", "semantic", "value", "unit"],
        ["cycle", "limit"],
      ) &&
      (value.semantic === "consumed" || value.semantic === "spent") &&
      isFiniteNumber(value.value) &&
      isSafeText(value.unit, 128) &&
      isOptionalFiniteNumber(value.limit)
    );
  }
  return (
    value.type === "balance" &&
    hasExactKeys(
      value,
      ["type", "id", "label", "scope", "value", "unit"],
      ["cycle", "initialLimit"],
    ) &&
    isFiniteNumber(value.value) &&
    isSafeText(value.unit, 128) &&
    isOptionalFiniteNumber(value.initialLimit)
  );
}

function copyUsageMetric(metric: UsageMetric): UsageMetric {
  const cycle = copyCycle(metric.cycle);
  const base = {
    id: metric.id,
    label: metric.label,
    scope: metric.scope,
    ...(cycle ? { cycle } : {}),
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

function isUsageGroup(value: unknown): value is UsageGroup {
  return (
    hasExactKeys(value, ["id", "label", "metricIds"], ["description"]) &&
    isSafeText(value.id, 128) &&
    isSafeText(value.label) &&
    (value.description === undefined || isSafeText(value.description, 1_024)) &&
    Array.isArray(value.metricIds) &&
    value.metricIds.every((metricId) => isSafeText(metricId, 128))
  );
}

function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  return (
    hasExactKeys(
      value,
      ["providerKind", "source", "fetchedAt", "metrics"],
      ["accountLabel", "planLabel", "usageGroups"],
    ) &&
    isProviderId(value.providerKind) &&
    (value.accountLabel === undefined || isSafeText(value.accountLabel)) &&
    (value.planLabel === undefined || isSafeText(value.planLabel)) &&
    (value.source === "web-session" ||
      value.source === "oauth" ||
      value.source === "api-key" ||
      value.source === "fixture") &&
    isFiniteNumber(value.fetchedAt) &&
    Array.isArray(value.metrics) &&
    value.metrics.every(isUsageMetric) &&
    (value.usageGroups === undefined ||
      (Array.isArray(value.usageGroups) && value.usageGroups.every(isUsageGroup)))
  );
}

function copySnapshot(snapshot: UsageSnapshot): UsageSnapshot {
  return {
    providerKind: snapshot.providerKind,
    ...(snapshot.accountLabel === undefined
      ? {}
      : { accountLabel: snapshot.accountLabel }),
    ...(snapshot.planLabel === undefined ? {} : { planLabel: snapshot.planLabel }),
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    metrics: snapshot.metrics.map(copyUsageMetric),
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

function isHistoryMetric(value: unknown): value is MetricHistorySample {
  if (!isRecord(value)) return false;
  if (!isSafeText(value.metricId, 128) || (value.cycle !== undefined && !isMetricCycle(value.cycle))) {
    return false;
  }
  if (value.type === "quota") {
    return (
      hasExactKeys(value, ["type", "metricId", "usedRatio"], ["cycle"]) &&
      isFiniteNumber(value.usedRatio)
    );
  }
  if (value.type === "counter") {
    return (
      hasExactKeys(
        value,
        ["type", "metricId", "semantic", "value", "unit"],
        ["limit", "cycle"],
      ) &&
      (value.semantic === "consumed" || value.semantic === "spent") &&
      isFiniteNumber(value.value) &&
      isSafeText(value.unit, 128) &&
      isOptionalFiniteNumber(value.limit)
    );
  }
  return (
    value.type === "balance" &&
    hasExactKeys(
      value,
      ["type", "metricId", "value", "unit"],
      ["initialLimit", "cycle"],
    ) &&
    isFiniteNumber(value.value) &&
    isSafeText(value.unit, 128) &&
    isOptionalFiniteNumber(value.initialLimit)
  );
}

function copyHistoryMetric(metric: MetricHistorySample): MetricHistorySample {
  const cycle = copyCycle(metric.cycle);
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

function isHistoryObservation(value: unknown): value is UsageHistoryObservation {
  return (
    hasExactKeys(value, ["observedAt", "metrics"]) &&
    isFiniteNumber(value.observedAt) &&
    Array.isArray(value.metrics) &&
    value.metrics.every(isHistoryMetric)
  );
}

const refreshTriggers = new Set<RefreshTrigger>([
  "connect",
  "manual_provider",
  "manual_all",
  "scheduled",
]);
const deferredReasons = new Set<DeferredReason>(["session_required", "backoff"]);
const failureCategories = new Set<FailureCategory>([
  "signed_out",
  "credential_invalid",
  "credential_scope_required",
  "challenge_blocked",
  "provider_changed",
  "temporary_error",
]);

function isAttemptOutcome(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "success") return hasExactKeys(value, ["kind"]);
  if (value.kind === "deferred") {
    return (
      hasExactKeys(value, ["kind", "reason"], ["retryAt"]) &&
      deferredReasons.has(value.reason as DeferredReason) &&
      isOptionalFiniteNumber(value.retryAt)
    );
  }
  return (
    value.kind === "failure" &&
    hasExactKeys(value, ["kind", "category"], ["message", "retryAt"]) &&
    failureCategories.has(value.category as FailureCategory) &&
    (value.message === undefined || isSafeText(value.message, 1_024)) &&
    isOptionalFiniteNumber(value.retryAt)
  );
}

function isProviderAttempt(value: unknown): value is ProviderAttempt {
  return (
    hasExactKeys(value, ["trigger", "startedAt", "finishedAt", "outcome"]) &&
    refreshTriggers.has(value.trigger as RefreshTrigger) &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.finishedAt) &&
    isAttemptOutcome(value.outcome)
  );
}

function copyAttempt(attempt: ProviderAttempt): ProviderAttempt {
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

function isNormalizedBaseUrl(value: unknown): value is string {
  return typeof value === "string" && normalizeNewApiBaseUrl(value) === value;
}

function isNormalizedOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return (
      value === parsed.origin &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")))
    );
  } catch {
    return false;
  }
}

function parseProviderInstanceView(value: unknown): ProviderInstanceView {
  if (
    !hasExactKeys(
      value,
      ["id", "providerKind", "access", "createdAt", "history"],
      ["userLabel", "baseUrl", "origin", "snapshot", "lastAttempt"],
    ) ||
    !isProviderInstanceId(value.id) ||
    !isProviderId(value.providerKind) ||
    (value.access !== "required" && value.access !== "granted") ||
    !isFiniteNumber(value.createdAt) ||
    !Array.isArray(value.history) ||
    !value.history.every(isHistoryObservation) ||
    (Object.hasOwn(value, "userLabel") &&
      (!isSafeText(value.userLabel, 128) || value.userLabel.trim() !== value.userLabel)) ||
    (Object.hasOwn(value, "baseUrl") && !isNormalizedBaseUrl(value.baseUrl)) ||
    (Object.hasOwn(value, "origin") && !isNormalizedOrigin(value.origin)) ||
    (Object.hasOwn(value, "snapshot") && !isUsageSnapshot(value.snapshot)) ||
    (Object.hasOwn(value, "lastAttempt") && !isProviderAttempt(value.lastAttempt))
  ) {
    throw new Error("Missing application state");
  }
  const snapshot = value.snapshot as UsageSnapshot | undefined;
  const attempt = value.lastAttempt as ProviderAttempt | undefined;
  return {
    id: value.id,
    providerKind: value.providerKind,
    ...(value.userLabel === undefined ? {} : { userLabel: value.userLabel as string }),
    ...(value.baseUrl === undefined ? {} : { baseUrl: value.baseUrl as string }),
    ...(value.origin === undefined ? {} : { origin: value.origin as string }),
    access: value.access,
    createdAt: value.createdAt,
    history: (value.history as UsageHistoryObservation[]).map((observation) => ({
      observedAt: observation.observedAt,
      metrics: observation.metrics.map(copyHistoryMetric),
    })),
    ...(snapshot ? { snapshot: copySnapshot(snapshot) } : {}),
    ...(attempt ? { lastAttempt: copyAttempt(attempt) } : {}),
  };
}

export function parseAppViewState(value: unknown): AppViewState {
  if (
    !hasExactKeys(value, ["preferences", "instances"]) ||
    !hasExactKeys(value.preferences, ["displayMode", "autoRefresh"]) ||
    (value.preferences.displayMode !== "used" &&
      value.preferences.displayMode !== "left") ||
    typeof value.preferences.autoRefresh !== "boolean" ||
    !Array.isArray(value.instances)
  ) {
    throw new Error("Missing application state");
  }
  const state: AppViewState = {
    preferences: {
      displayMode: value.preferences.displayMode,
      autoRefresh: value.preferences.autoRefresh,
    },
    instances: value.instances.map(parseProviderInstanceView),
  };
  const ids = new Set<ProviderInstanceId>();
  for (const instance of state.instances) {
    if (ids.has(instance.id) || !instance.id.startsWith(`${instance.providerKind}:`)) {
      throw new Error("Missing application state");
    }
    ids.add(instance.id);
    if (instance.snapshot?.providerKind !== undefined && instance.snapshot.providerKind !== instance.providerKind) {
      throw new Error("Missing application state");
    }
    if (instance.baseUrl && new URL(instance.baseUrl).origin !== instance.origin) {
      throw new Error("Missing application state");
    }
    if ((instance.baseUrl === undefined) !== (instance.origin === undefined)) {
      throw new Error("Missing application state");
    }
  }
  return state;
}

function isProviderRefreshOutcome(
  value: unknown,
  instanceId: ProviderInstanceId,
): value is ProviderRefreshOutcome {
  if (!isRecord(value)) return false;
  if (value.kind === "success") {
    return (
      hasExactKeys(value, ["kind", "snapshot"]) &&
      isUsageSnapshot(value.snapshot) &&
      instanceId.startsWith(`${value.snapshot.providerKind}:`)
    );
  }
  if (value.kind === "deferred") {
    return (
      hasExactKeys(value, ["kind", "reason"], ["retryAt"]) &&
      deferredReasons.has(value.reason as DeferredReason) &&
      isOptionalFiniteNumber(value.retryAt)
    );
  }
  if (value.kind === "failure") {
    return (
      hasExactKeys(value, ["kind", "category"], ["message", "retryAt"]) &&
      failureCategories.has(value.category as FailureCategory) &&
      (value.message === undefined || isSafeText(value.message, 1_024)) &&
      isOptionalFiniteNumber(value.retryAt)
    );
  }
  return (
    value.kind === "skipped" &&
    hasExactKeys(value, ["kind", "reason"]) &&
    (value.reason === "permission_required" ||
      value.reason === "auto_refresh_disabled" ||
      value.reason === "superseded")
  );
}

function copyRefreshOutcome(outcome: ProviderRefreshOutcome): ProviderRefreshOutcome {
  if (outcome.kind === "success") {
    return { kind: "success", snapshot: copySnapshot(outcome.snapshot) };
  }
  if (outcome.kind === "deferred") {
    return {
      kind: "deferred",
      reason: outcome.reason,
      ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
    };
  }
  if (outcome.kind === "failure") {
    return {
      kind: "failure",
      category: outcome.category,
      ...(outcome.message === undefined ? {} : { message: outcome.message }),
      ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
    };
  }
  return { kind: "skipped", reason: outcome.reason };
}

export function parseRefreshReport(value: unknown): RefreshReport {
  if (
    !hasExactKeys(value, ["trigger", "startedAt", "finishedAt", "results"]) ||
    !refreshTriggers.has(value.trigger as RefreshTrigger) ||
    !isFiniteNumber(value.startedAt) ||
    !isFiniteNumber(value.finishedAt) ||
    !Array.isArray(value.results) ||
    !value.results.every(
      (result) =>
        hasExactKeys(result, ["instanceId", "outcome"]) &&
        isProviderInstanceId(result.instanceId) &&
        isProviderRefreshOutcome(result.outcome, result.instanceId),
    )
  ) {
    throw new Error("Missing refresh response");
  }
  const typed = value.results as Array<{
    instanceId: ProviderInstanceId;
    outcome: ProviderRefreshOutcome;
  }>;
  const ids = typed.map(({ instanceId }) => instanceId);
  if (new Set(ids).size !== ids.length) throw new Error("Missing refresh response");
  return {
    trigger: value.trigger as RefreshTrigger,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    results: typed.map(({ instanceId, outcome }) => ({
      instanceId,
      outcome: copyRefreshOutcome(outcome),
    })),
  };
}

export function parseRefreshResponse(value: unknown): RefreshResponse {
  if (!hasExactKeys(value, ["state", "report"])) {
    throw new Error("Missing refresh response");
  }
  return {
    state: parseAppViewState(value.state),
    report: parseRefreshReport(value.report),
  };
}

export function parseDeleteResponse(value: unknown): DeleteResponse {
  if (
    !hasExactKeys(value, ["state", "result"]) ||
    (value.result !== "deleted" && value.result !== "deleted_with_permission_errors")
  ) {
    throw new Error("Missing delete response");
  }
  return { state: parseAppViewState(value.state), result: value.result };
}

export function parseDisconnectResponse(value: unknown): DisconnectResponse {
  if (
    !hasExactKeys(value, ["state", "result"]) ||
    !hasExactKeys(
      value.result,
      ["ok", "localDataDeleted"],
      isRecord(value.result) && value.result.ok === false ? ["error"] : [],
    ) ||
    value.result.localDataDeleted !== true ||
    (value.result.ok !== true &&
      (value.result.ok !== false || value.result.error !== "permission_removal_failed"))
  ) {
    throw new Error("Missing disconnect response");
  }
  return {
    state: parseAppViewState(value.state),
    result:
      value.result.ok === true
        ? { ok: true, localDataDeleted: true }
        : {
            ok: false,
            error: "permission_removal_failed",
            localDataDeleted: true,
          },
  };
}

const apiKeyConnectionStatuses = new Set<ApiKeyConnectionStatus>([
  "connected",
  "invalid_key",
  "insufficient_scope",
  "invalid_site",
  "temporary_error",
]);

export function parseApiKeyConnectionResponse(
  value: unknown,
): ApiKeyConnectionResponse {
  if (
    !hasExactKeys(value, ["state", "report", "result"]) ||
    typeof value.result !== "string" ||
    !apiKeyConnectionStatuses.has(value.result as ApiKeyConnectionStatus)
  ) {
    throw new Error("Missing API key connection response");
  }
  return {
    state: parseAppViewState(value.state),
    report: parseRefreshReport(value.report),
    result: value.result as ApiKeyConnectionStatus,
  };
}

export function parsePermissionIntentResponse(
  value: unknown,
): PermissionIntentResponse {
  if (
    !hasExactKeys(value, ["state", "permissionIntentId", "instanceId", "permissions"]) ||
    !isPermissionIntentId(value.permissionIntentId) ||
    !isProviderInstanceId(value.instanceId) ||
    !hasExactKeys(value.permissions, [], ["origins", "permissions"]) ||
    (value.permissions.origins !== undefined &&
      (!Array.isArray(value.permissions.origins) ||
        !value.permissions.origins.every((origin) => typeof origin === "string"))) ||
    (value.permissions.permissions !== undefined &&
      (!Array.isArray(value.permissions.permissions) ||
        !value.permissions.permissions.every((permission) => typeof permission === "string")))
  ) {
    throw new Error("Missing permission intent response");
  }
  return {
    state: parseAppViewState(value.state),
    permissionIntentId: value.permissionIntentId,
    instanceId: value.instanceId,
    permissions: {
      ...(value.permissions.origins === undefined
        ? {}
        : { origins: [...value.permissions.origins] }),
      ...(value.permissions.permissions === undefined
        ? {}
        : { permissions: [...value.permissions.permissions] }),
    } as Browser.permissions.Permissions,
  };
}

export function isProviderOperationEvent(
  value: unknown,
): value is ProviderOperationEvent {
  return (
    hasExactKeys(value, ["type", "instanceId", "operation"]) &&
    value.type === "PROVIDER_OPERATION" &&
    isProviderInstanceId(value.instanceId) &&
    value.operation === "waiting_for_session"
  );
}

export function isApiKeyConnectionStatus(
  value: unknown,
): value is ApiKeyConnectionStatus {
  return (
    typeof value === "string" &&
    apiKeyConnectionStatuses.has(value as ApiKeyConnectionStatus)
  );
}

export function isPublicProviderKind(value: unknown): value is ProviderKind {
  return isProviderId(value);
}

export function isPublicApiKeyProviderKind(
  value: unknown,
): value is ApiKeyProviderKind {
  return isApiKeyProviderId(value);
}
