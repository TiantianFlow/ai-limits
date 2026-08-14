import React, { useEffect, useRef, useState } from "react";

import type {
  ApiKeyConnectionStatus,
} from "../../background/api-key-connection";
import {
  isProviderOperationEvent,
  type ProviderOperation,
} from "../../background/events";
import type { RuntimeCommand } from "../../background/messages";
import type {
  ConnectApiKeyProviderResult,
  DisconnectInstanceResult,
} from "../../background/provider-service";
import type {
  AppViewState,
  ProviderInstanceView,
} from "../../background/view-state";
import {
  isProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "../../domain/instances";
import type {
  DeferredReason,
  DisplayMode,
  FailureCategory,
  ProviderAttempt,
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
  UsageHistoryObservation,
  UsageMetric,
  UsageSnapshot,
} from "../../domain/model";
import {
  isApiKeyProviderId,
  isProviderId,
  type ApiKeyProviderKind,
  type BrowserSessionProviderKind,
  type ProviderKind,
  providerCatalog,
  providerNames,
} from "../../providers/catalog";
import {
  normalizeProviderConfig,
} from "../../providers/package-factories";
import { Cockpit } from "./Cockpit";
import type { ApiKeySubmission } from "./Cockpit";
import { instanceLabel } from "./instance-label";
import type { ApiKeyConnectAttemptResult } from "./views/ApiKeyConnectView";

interface RefreshResponse {
  state: AppViewState;
  report: RefreshReport;
}

interface DeleteResponse {
  state: AppViewState;
  result: "deleted" | "deleted_with_permission_errors";
}

interface DisconnectResponse {
  state: AppViewState;
  result: DisconnectInstanceResult;
}

interface ApiKeyConnectionResponse extends ConnectApiKeyProviderResult {
  state: AppViewState;
}

interface Announcement {
  id: number;
  message: string;
}

interface AutoRefreshGuard {
  priorValue: boolean;
}

type ProviderOperations = Partial<Record<ProviderInstanceId, ProviderOperation>>;

interface PermissionIntentResponse {
  state: AppViewState;
  permissionIntentId: string;
  instanceId: ProviderInstanceId;
  permissions: Browser.permissions.Permissions;
}

const publicInstanceKeys = new Set([
  "id",
  "providerKind",
  "userLabel",
  "origin",
  "access",
  "createdAt",
  "history",
  "snapshot",
  "lastAttempt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeText(
  value: unknown,
  maximumLength = 512,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isMetricCycle(value: unknown): boolean {
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
        (Array.isArray(value.segments) &&
          value.segments.every(isMetricSegment)))
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
  if (value.type === "balance") {
    return (
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
  return false;
}

function isUsageGroup(value: unknown): boolean {
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
      (Array.isArray(value.usageGroups) &&
        value.usageGroups.every(isUsageGroup)))
  );
}

function isHistoryMetric(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const commonValid =
    isSafeText(value.metricId, 128) &&
    (value.cycle === undefined || isMetricCycle(value.cycle));
  if (!commonValid) return false;
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
  if (value.type === "balance") {
    return (
      hasExactKeys(value, ["type", "metricId", "value", "unit"], ["initialLimit", "cycle"]) &&
      isFiniteNumber(value.value) &&
      isSafeText(value.unit, 128) &&
      isOptionalFiniteNumber(value.initialLimit)
    );
  }
  return false;
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
  if (value.kind === "failure") {
    return (
      hasExactKeys(value, ["kind", "category"], ["message", "retryAt"]) &&
      failureCategories.has(value.category as FailureCategory) &&
      (value.message === undefined || isSafeText(value.message, 1_024)) &&
      isOptionalFiniteNumber(value.retryAt)
    );
  }
  return false;
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

function asProviderInstanceView(value: unknown): ProviderInstanceView {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !publicInstanceKeys.has(key)) ||
    !isProviderInstanceId(value.id) ||
    !isProviderId(value.providerKind) ||
    (value.access !== "required" && value.access !== "granted") ||
    !isFiniteNumber(value.createdAt) ||
    !Array.isArray(value.history) ||
    !value.history.every(isHistoryObservation) ||
    (Object.hasOwn(value, "userLabel") &&
      (!isSafeText(value.userLabel, 128) || value.userLabel.trim() !== value.userLabel)) ||
    (Object.hasOwn(value, "origin") && !isNormalizedOrigin(value.origin)) ||
    (Object.hasOwn(value, "snapshot") && !isUsageSnapshot(value.snapshot)) ||
    (Object.hasOwn(value, "lastAttempt") && !isProviderAttempt(value.lastAttempt))
  ) {
    throw new Error("Missing application state");
  }
  return value as unknown as ProviderInstanceView;
}

function asAppViewState(value: unknown): AppViewState {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "preferences") ||
    !Object.hasOwn(value, "instances") ||
    !isRecord(value.preferences) ||
    Object.keys(value.preferences).length !== 2 ||
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
    instances: value.instances.map(asProviderInstanceView),
  };
  const ids = new Set<ProviderInstanceId>();
  for (const instance of state.instances) {
    if (ids.has(instance.id)) throw new Error("Missing application state");
    ids.add(instance.id);
    if (!instance.id.startsWith(`${instance.providerKind}:`)) {
      throw new Error("Missing application state");
    }
    if (
      instance.snapshot &&
      instance.snapshot.providerKind !== instance.providerKind
    ) {
      throw new Error("Missing application state");
    }
  }
  return state;
}

function asRefreshReport(value: unknown): RefreshReport {
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
  const ids = value.results.map((result) => result.instanceId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Missing refresh response");
  }
  return value as unknown as RefreshReport;
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

function manualSummary(report: RefreshReport, state: AppViewState): string {
  const attempted = report.results.filter(
    ({ outcome }) =>
      !(outcome.kind === "skipped" && outcome.reason === "permission_required"),
  );
  if (attempted.length === 0) {
    return "Connect a provider before refreshing.";
  }

  const successes = attempted.filter(({ outcome }) => outcome.kind === "success");
  if (successes.length === attempted.length) {
    return `Updated ${successes.length} provider${successes.length === 1 ? "" : "s"}.`;
  }
  if (successes.length === 0) {
    return "No providers updated. Existing data is unchanged.";
  }

  const nonSuccesses = attempted.filter(
    ({ outcome }) => outcome.kind !== "success",
  );
  const onlyNonSuccess = nonSuccesses[0];
  const kimiIsOnlyNonSuccess =
    nonSuccesses.length === 1 &&
    state.instances.find(({ id }) => id === onlyNonSuccess?.instanceId)
      ?.providerKind === "kimi" &&
    onlyNonSuccess?.outcome.kind === "deferred" &&
    onlyNonSuccess.outcome.reason === "session_required";

  return `Updated ${successes.length} of ${attempted.length}. ${
    kimiIsOnlyNonSuccess
      ? "Kimi needs a browser session."
      : "Some providers need attention."
  }`;
}

function confirmationFailure(label?: string): string {
  const subject = label ? `${label} refresh` : "refresh";
  return `Couldn’t confirm the ${subject} result. Check the latest usage before retrying.`;
}

function asRefreshResponse(value: unknown): RefreshResponse {
  if (!hasExactKeys(value, ["state", "report"])) {
    throw new Error("Missing refresh response");
  }
  return {
    state: asAppViewState(value.state),
    report: asRefreshReport(value.report),
  };
}

function asDeleteResponse(value: unknown): DeleteResponse {
  if (
    !hasExactKeys(value, ["state", "result"]) ||
    (value.result !== "deleted" &&
      value.result !== "deleted_with_permission_errors")
  ) {
    throw new Error("Missing delete response");
  }
  return { state: asAppViewState(value.state), result: value.result };
}

function asDisconnectResponse(value: unknown): DisconnectResponse {
  if (
    !hasExactKeys(value, ["state", "result"]) ||
    !hasExactKeys(
      value.result,
      ["ok", "localDataDeleted"],
      value.result && isRecord(value.result) && value.result.ok === false
        ? ["error"]
        : [],
    ) ||
    value.result.localDataDeleted !== true ||
    (value.result.ok !== true &&
      (value.result.ok !== false ||
        value.result.error !== "permission_removal_failed"))
  ) {
    throw new Error("Missing disconnect response");
  }
  return {
    state: asAppViewState(value.state),
    result: value.result as unknown as DisconnectInstanceResult,
  };
}

const apiKeyConnectionStatuses = new Set<ApiKeyConnectionStatus>([
  "connected",
  "invalid_key",
  "insufficient_scope",
  "invalid_site",
  "temporary_error",
]);

function asApiKeyConnectionResponse(value: unknown): ApiKeyConnectionResponse {
  if (
    !hasExactKeys(value, ["state", "report", "result"]) ||
    typeof value.result !== "string" ||
    !apiKeyConnectionStatuses.has(value.result as ApiKeyConnectionStatus)
  ) {
    throw new Error("Missing API key connection response");
  }
  return {
    state: asAppViewState(value.state),
    report: asRefreshReport(value.report),
    result: value.result as ApiKeyConnectionStatus,
  };
}

function asPermissionIntentResponse(value: unknown): PermissionIntentResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !["state", "permissionIntentId", "instanceId", "permissions"].includes(
          key,
        ),
    ) ||
    Object.keys(value).length !== 4 ||
    typeof value.permissionIntentId !== "string" ||
    !isProviderInstanceId(value.instanceId) ||
    !isRecord(value.permissions) ||
    Object.keys(value.permissions).some(
      (key) => key !== "origins" && key !== "permissions",
    ) ||
    (Object.hasOwn(value.permissions, "origins") &&
      (!Array.isArray(value.permissions.origins) ||
        !value.permissions.origins.every((origin) => typeof origin === "string"))) ||
    (Object.hasOwn(value.permissions, "permissions") &&
      (!Array.isArray(value.permissions.permissions) ||
        !value.permissions.permissions.every(
          (permission) => typeof permission === "string",
        )))
  ) {
    throw new Error("Missing permission intent response");
  }
  return {
    state: asAppViewState(value.state),
    permissionIntentId: value.permissionIntentId,
    instanceId: value.instanceId,
    permissions: value.permissions as Browser.permissions.Permissions,
  };
}

export function App() {
  const [viewState, setViewState] = useState<AppViewState>();
  const viewStateRef = useRef<AppViewState | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement>({
    id: 0,
    message: "",
  });
  const [isAutoRefreshPending, setIsAutoRefreshPending] = useState(false);
  const autoRefreshGuard = useRef<AutoRefreshGuard | undefined>(undefined);
  const [providerOperations, setProviderOperations] =
    useState<ProviderOperations>({});

  const commitViewState = (next: AppViewState) => {
    viewStateRef.current = next;
    setViewState(next);
  };

  useEffect(() => {
    let mounted = true;

    const reloadView = async () => {
      const next = asAppViewState(
        await browser.runtime.sendMessage({ type: "GET_STATE" }),
      );
      if (mounted) commitViewState(next);
      return next;
    };

    void reloadView().catch(() => {
      if (mounted) setLoadFailed(true);
    });

    const handleStorageChange = (
      _changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      const guardAtEvent = autoRefreshGuard.current;
      void browser.runtime
        .sendMessage({ type: "GET_STATE" })
        .then(asAppViewState)
        .then((nextState) => {
          if (!mounted || guardAtEvent !== autoRefreshGuard.current) return;
          const activeGuard = autoRefreshGuard.current;
          commitViewState(
            activeGuard
              ? {
                  ...nextState,
                  preferences: {
                    ...nextState.preferences,
                    autoRefresh: activeGuard.priorValue,
                  },
                }
              : nextState,
          );
        })
        .catch(() => undefined);
    };
    const handleRuntimeMessage = (message: unknown) => {
      if (!isProviderOperationEvent(message)) return false;
      setProviderOperations((current) =>
        current[message.instanceId] === "fetching"
          ? { ...current, [message.instanceId]: message.operation }
          : current,
      );
      return false;
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    browser.runtime.onMessage.addListener(handleRuntimeMessage);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
      window.clearInterval(clock);
    };
  }, [loadAttempt]);

  const setProviderOperation = (
    instanceId: ProviderInstanceId,
    operation?: ProviderOperation,
  ) => {
    setProviderOperations((current) => {
      const next = { ...current };
      if (operation) next[instanceId] = operation;
      else delete next[instanceId];
      return next;
    });
  };

  const clearAnnouncement = () => {
    setAnnouncement((current) => ({ id: current.id + 1, message: "" }));
  };

  const announce = (message: string) => {
    setAnnouncement((current) => ({ id: current.id + 1, message }));
  };

  const handleDisplayModeChange = (mode: DisplayMode) => {
    if (viewStateRef.current) {
      commitViewState({
        ...viewStateRef.current,
        preferences: { ...viewStateRef.current.preferences, displayMode: mode },
      });
    }
    void browser.runtime
      .sendMessage({ type: "SET_DISPLAY_MODE", mode } satisfies RuntimeCommand)
      .then(asAppViewState)
      .then(commitViewState)
      .catch(() => undefined);
  };

  const abandonPermissionIntent = async (permissionIntentId: string) => {
    try {
      commitViewState(
        asAppViewState(
          await browser.runtime.sendMessage({
            type: "ABANDON_PROVIDER_PERMISSION",
            permissionIntentId,
          } satisfies RuntimeCommand),
        ),
      );
    } catch {
      // The persisted bounded intent is also swept by the background alarm.
    }
  };

  const preparePermission = async (
    providerKind: ProviderKind,
    config: ProviderInstanceConfig,
    instanceId?: ProviderInstanceId,
    userLabel?: string,
  ) => {
    const prepared = asPermissionIntentResponse(
      await browser.runtime.sendMessage({
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind,
        ...(instanceId ? { instanceId } : {}),
        ...(userLabel !== undefined ? { userLabel } : {}),
        config,
      } satisfies RuntimeCommand),
    );
    commitViewState(prepared.state);
    return prepared;
  };

  const requestPreparedPermission = async (
    prepared: PermissionIntentResponse,
  ): Promise<boolean> => {
    try {
      const required =
        (prepared.permissions.origins?.length ?? 0) > 0 ||
        (prepared.permissions.permissions?.length ?? 0) > 0;
      const granted = required
        ? Boolean(await browser.permissions.request(prepared.permissions))
        : true;
      commitViewState(
        asAppViewState(
          await browser.runtime.sendMessage({
            type: "RESOLVE_PROVIDER_PERMISSION",
            permissionIntentId: prepared.permissionIntentId,
            granted,
          } satisfies RuntimeCommand),
        ),
      );
      return granted;
    } catch (error) {
      await abandonPermissionIntent(prepared.permissionIntentId);
      throw error;
    }
  };

  const handleConnectProvider = async (providerKind: ProviderKind) => {
    if (isApiKeyProviderId(providerKind)) return;
    clearAnnouncement();
    const config = normalizeProviderConfig(providerKind, { kind: "fixed" });
    const existingInstanceId = viewStateRef.current?.instances.find(
      (instance) => instance.providerKind === providerKind,
    )?.id;
    let prepared: PermissionIntentResponse;
    try {
      if (!config) throw new Error("Invalid provider config");
      prepared = await preparePermission(providerKind, config, existingInstanceId);
    } catch {
      announce(`Couldn’t connect ${providerNames[providerKind]}. Reload AI Limits and try again.`);
      return;
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(`Couldn’t connect ${providerNames[providerKind]}. Reload AI Limits and try again.`);
      setProviderOperation(prepared.instanceId);
      return;
    }
    if (!granted) {
      announce(`${providerNames[providerKind]} was not connected.`);
      setProviderOperation(prepared.instanceId);
      return;
    }

    try {
      setProviderOperation(prepared.instanceId, "fetching");
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({
          type: "CONNECT_BROWSER_PROVIDER",
          providerKind: providerKind as BrowserSessionProviderKind,
          permissionIntentId: prepared.permissionIntentId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      announce(manualSummary(response.report, response.state));
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(confirmationFailure(providerNames[providerKind]));
    } finally {
      setProviderOperation(prepared.instanceId);
    }
  };

  const handleOpenApiKeySetup = (providerKind: ApiKeyProviderKind) => {
    const connection = providerCatalog[providerKind].connection;
    if (connection.origin !== "static") return;
    void browser.tabs.create({ url: connection.setupUrl }).catch(() => {
      announce("Couldn’t open the ElevenLabs API keys page. Try the link again.");
    });
  };

  const handleSubmitApiKey = async (
    submission: ApiKeySubmission,
  ): Promise<ApiKeyConnectAttemptResult> => {
    const {
      providerKind,
      apiKey,
      baseUrl,
      instanceId,
      userLabel,
    } = submission;
    const config = normalizeProviderConfig(
      providerKind,
      providerKind === "newapi"
        ? { kind: "dynamic-origin", baseUrl }
        : { kind: "fixed" },
    );
    if (!config) return "invalid_site";
    clearAnnouncement();
    let prepared: PermissionIntentResponse;
    try {
      prepared = await preparePermission(
        providerKind,
        config,
        instanceId,
        userLabel,
      );
    } catch {
      announce(`${providerNames[providerKind]} could not be validated right now. Try again later.`);
      return "temporary_error";
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(`${providerNames[providerKind]} could not be validated right now. Try again later.`);
      setProviderOperation(prepared.instanceId);
      return "temporary_error";
    }
    if (!granted) {
      announce(`${providerNames[providerKind]} access was not changed.`);
      setProviderOperation(prepared.instanceId);
      return "permission_declined";
    }

    try {
      setProviderOperation(prepared.instanceId, "fetching");
      const response = asApiKeyConnectionResponse(
        await browser.runtime.sendMessage({
          type: "CONNECT_API_KEY_PROVIDER",
          providerKind,
          instanceId: prepared.instanceId,
          ...(userLabel !== undefined ? { userLabel } : {}),
          config,
          apiKey,
          permissionIntentId: prepared.permissionIntentId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      switch (response.result) {
        case "connected":
          announce(`Connected ${userLabel?.trim() || providerNames[providerKind]}.`);
          break;
        case "invalid_key":
          announce(`Enter a valid ${providerNames[providerKind]} API key.`);
          break;
        case "insufficient_scope":
          announce(
            providerKind === "elevenlabs"
              ? "Allow User → Read and check any IP restrictions, then try again."
              : "This relay key could not read its usage. Check the key and any IP restrictions.",
          );
          break;
        case "invalid_site":
          announce("This site did not return compatible New API status and usage data.");
          break;
        case "temporary_error":
          announce(`${providerNames[providerKind]} could not be validated right now. Try again later.`);
          break;
      }
      return response.result;
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(`${providerNames[providerKind]} could not be validated right now. Try again later.`);
      return "temporary_error";
    } finally {
      setProviderOperation(prepared.instanceId);
    }
  };

  const handleRefreshInstance = async (instanceId: ProviderInstanceId) => {
    const instance = viewStateRef.current?.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) return;
    const label = instanceLabel(instance);
    clearAnnouncement();
    setProviderOperation(instanceId, "fetching");
    try {
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({
          type: "REFRESH_INSTANCE",
          instanceId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      announce(manualSummary(response.report, response.state));
    } catch {
      announce(confirmationFailure(label));
    } finally {
      setProviderOperation(instanceId);
    }
  };

  const handleRefresh = async () => {
    const current = viewStateRef.current;
    if (isRefreshing || !current) return;
    setIsRefreshing(true);
    clearAnnouncement();
    setProviderOperations(
      Object.fromEntries(
        current.instances
          .filter(({ access }) => access === "granted")
          .map(({ id }) => [id, "fetching"] as const),
      ),
    );
    try {
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({ type: "REFRESH_ALL" } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      announce(manualSummary(response.report, response.state));
    } catch {
      announce(confirmationFailure());
    } finally {
      setProviderOperations({});
      setIsRefreshing(false);
    }
  };

  const handleAutoRefreshChange = async (enabled: boolean) => {
    const current = viewStateRef.current;
    if (!current || autoRefreshGuard.current) return;
    const guard = { priorValue: current.preferences.autoRefresh };
    autoRefreshGuard.current = guard;
    clearAnnouncement();
    setIsAutoRefreshPending(true);
    try {
      const authoritative = asAppViewState(
        await browser.runtime.sendMessage({
          type: "SET_AUTO_REFRESH",
          enabled,
        } satisfies RuntimeCommand),
      );
      if (autoRefreshGuard.current === guard) {
        autoRefreshGuard.current = undefined;
        commitViewState(authoritative);
      }
      announce(`Automatic refresh turned ${enabled ? "on" : "off"}.`);
    } catch {
      if (autoRefreshGuard.current === guard) autoRefreshGuard.current = undefined;
      try {
        commitViewState(
          asAppViewState(
            await browser.runtime.sendMessage({ type: "GET_STATE" }),
          ),
        );
      } catch {
        // The prior rendered view remains authoritative enough for recovery.
      }
      announce("Couldn’t update automatic refresh.");
    } finally {
      setIsAutoRefreshPending(false);
    }
  };

  const handleDisconnectInstance = async (instanceId: ProviderInstanceId) => {
    const instance = viewStateRef.current?.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) return;
    const label = instanceLabel(instance);
    clearAnnouncement();
    try {
      const response = asDisconnectResponse(
        await browser.runtime.sendMessage({
          type: "DISCONNECT_INSTANCE",
          instanceId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      announce(
        response.result.ok
          ? `Disconnected ${label} and deleted its stored usage.`
          : `Deleted ${label}’s local usage. Browser access could not be removed.`,
      );
    } catch {
      announce(`Couldn’t disconnect ${label}.`);
    }
  };

  const handleRenameInstance = async (
    instanceId: ProviderInstanceId,
    userLabel?: string,
  ) => {
    const current = viewStateRef.current?.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!current) return;
    clearAnnouncement();
    try {
      const next = asAppViewState(
        await browser.runtime.sendMessage({
          type: "RENAME_INSTANCE",
          instanceId,
          ...(userLabel ? { userLabel } : {}),
        } satisfies RuntimeCommand),
      );
      commitViewState(next);
      const renamed = next.instances.find((instance) => instance.id === instanceId);
      announce(`Renamed connection to ${renamed ? instanceLabel(renamed) : providerNames[current.providerKind]}.`);
    } catch {
      announce(`Couldn’t rename ${instanceLabel(current)}.`);
    }
  };

  const handleDeleteLocalData = async () => {
    clearAnnouncement();
    try {
      const response = asDeleteResponse(
        await browser.runtime.sendMessage({
          type: "DELETE_LOCAL_DATA",
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      setProviderOperations({});
      announce(
        response.result === "deleted"
          ? "Local usage data deleted and providers disconnected."
          : "Local usage data deleted. Some provider access could not be removed.",
      );
    } catch {
      announce("Couldn’t delete local data.");
    }
  };

  if (!viewState) {
    if (loadFailed) {
      return (
        <main className="loading-state">
          <p>Couldn’t load usage.</p>
          <button
            className="button button--secondary"
            type="button"
            aria-label="Retry loading usage"
            onClick={() => {
              setLoadFailed(false);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Retry
          </button>
        </main>
      );
    }
    return <main className="loading-state">Loading usage…</main>;
  }

  return (
    <Cockpit
      state={viewState}
      now={now}
      isRefreshing={isRefreshing}
      refreshAnnouncement={announcement.message}
      refreshAnnouncementId={announcement.id}
      autoRefreshPending={isAutoRefreshPending}
      providerOperations={providerOperations}
      onDisplayModeChange={handleDisplayModeChange}
      onRefresh={() => void handleRefresh()}
      onConnectProvider={(providerId) => void handleConnectProvider(providerId)}
      onOpenApiKeySetup={handleOpenApiKeySetup}
      onSubmitApiKey={handleSubmitApiKey}
      onRefreshInstance={(instanceId) => void handleRefreshInstance(instanceId)}
      onAutoRefreshChange={(enabled) => void handleAutoRefreshChange(enabled)}
      onDisconnectInstance={(instanceId) => void handleDisconnectInstance(instanceId)}
      onRenameInstance={(instanceId, userLabel) =>
        void handleRenameInstance(instanceId, userLabel)
      }
      onDeleteLocalData={() => void handleDeleteLocalData()}
    />
  );
}
