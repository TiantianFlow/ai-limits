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
  DisplayMode,
  RefreshReport,
} from "../../domain/model";
import type { ConnectableProviderId } from "../../providers/registry";
import {
  isApiKeyProviderId,
  isProviderId,
  type ApiKeyProviderId,
  type BrowserSessionProviderKind,
  type ProviderId,
  providerCatalog,
  providerNames,
} from "../../providers/catalog";
import {
  normalizeProviderConfig,
} from "../../providers/package-factories";
import { Cockpit } from "./Cockpit";
import {
  projectLegacyInstanceOperations,
  projectLegacyInstanceState,
} from "./legacy-instance-adapter";
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

function asProviderInstanceView(value: unknown): ProviderInstanceView {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !publicInstanceKeys.has(key)) ||
    !isProviderInstanceId(value.id) ||
    !isProviderId(value.providerKind) ||
    (value.access !== "required" && value.access !== "granted") ||
    typeof value.createdAt !== "number" ||
    !Array.isArray(value.history) ||
    (Object.hasOwn(value, "userLabel") &&
      typeof value.userLabel !== "string") ||
    (Object.hasOwn(value, "origin") && typeof value.origin !== "string")
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
  projectLegacyInstanceState(state);
  return state;
}

function asRefreshReport(value: unknown): RefreshReport {
  if (
    !isRecord(value) ||
    typeof value.startedAt !== "number" ||
    typeof value.finishedAt !== "number" ||
    !Array.isArray(value.results) ||
    !value.results.every(
      (result) =>
        isRecord(result) &&
        isProviderInstanceId(result.instanceId) &&
        isRecord(result.outcome),
    )
  ) {
    throw new Error("Missing refresh response");
  }
  return value as unknown as RefreshReport;
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

function confirmationFailure(providerId?: ProviderId): string {
  const subject = providerId ? `${providerNames[providerId]} refresh` : "refresh";
  return `Couldn’t confirm the ${subject} result. Check the latest usage before retrying.`;
}

function asRefreshResponse(value: unknown): RefreshResponse {
  if (!isRecord(value) || !("state" in value) || !("report" in value)) {
    throw new Error("Missing refresh response");
  }
  return {
    state: asAppViewState(value.state),
    report: asRefreshReport(value.report),
  };
}

function asDeleteResponse(value: unknown): DeleteResponse {
  if (
    !isRecord(value) ||
    !("state" in value) ||
    (value.result !== "deleted" &&
      value.result !== "deleted_with_permission_errors")
  ) {
    throw new Error("Missing delete response");
  }
  return { state: asAppViewState(value.state), result: value.result };
}

function asDisconnectResponse(value: unknown): DisconnectResponse {
  if (
    !isRecord(value) ||
    !("state" in value) ||
    !isRecord(value.result) ||
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
    !isRecord(value) ||
    !("state" in value) ||
    !("report" in value) ||
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
    providerId: ProviderId,
    config: ProviderInstanceConfig,
    instanceId?: ProviderInstanceId,
  ) => {
    const prepared = asPermissionIntentResponse(
      await browser.runtime.sendMessage({
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind: providerId,
        ...(instanceId ? { instanceId } : {}),
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

  const handleConnectProvider = async (providerId: ConnectableProviderId) => {
    if (isApiKeyProviderId(providerId)) return;
    clearAnnouncement();
    const config = normalizeProviderConfig(providerId, { kind: "fixed" });
    const existingInstanceId = viewStateRef.current
      ? projectLegacyInstanceState(viewStateRef.current).instanceIds[providerId]
      : undefined;
    let prepared: PermissionIntentResponse;
    try {
      if (!config) throw new Error("Invalid provider config");
      prepared = await preparePermission(providerId, config, existingInstanceId);
    } catch {
      announce(`Couldn’t connect ${providerNames[providerId]}. Reload AI Limits and try again.`);
      return;
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(`Couldn’t connect ${providerNames[providerId]}. Reload AI Limits and try again.`);
      setProviderOperation(prepared.instanceId);
      return;
    }
    if (!granted) {
      announce(`${providerNames[providerId]} was not connected.`);
      setProviderOperation(prepared.instanceId);
      return;
    }

    try {
      setProviderOperation(prepared.instanceId, "fetching");
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({
          type: "CONNECT_BROWSER_PROVIDER",
          providerKind: providerId as BrowserSessionProviderKind,
          permissionIntentId: prepared.permissionIntentId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      announce(manualSummary(response.report, response.state));
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(confirmationFailure(providerId));
    } finally {
      setProviderOperation(prepared.instanceId);
    }
  };

  const handleOpenApiKeySetup = (providerId: ApiKeyProviderId) => {
    const connection = providerCatalog[providerId].connection;
    if (connection.origin !== "static") return;
    void browser.tabs.create({ url: connection.setupUrl }).catch(() => {
      announce("Couldn’t open the ElevenLabs API keys page. Try the link again.");
    });
  };

  const handleSubmitApiKey = async (
    providerId: ApiKeyProviderId,
    apiKey: string,
    baseUrl?: string,
  ): Promise<ApiKeyConnectAttemptResult> => {
    const config = normalizeProviderConfig(
      providerId,
      providerId === "newapi"
        ? { kind: "dynamic-origin", baseUrl }
        : { kind: "fixed" },
    );
    if (!config) return "invalid_site";
    const projection = viewStateRef.current
      ? projectLegacyInstanceState(viewStateRef.current)
      : undefined;
    const instanceId = projection?.instanceIds[providerId];
    clearAnnouncement();
    let prepared: PermissionIntentResponse;
    try {
      prepared = await preparePermission(providerId, config, instanceId);
    } catch {
      announce(`${providerNames[providerId]} could not be validated right now. Try again later.`);
      return "temporary_error";
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(`${providerNames[providerId]} could not be validated right now. Try again later.`);
      setProviderOperation(prepared.instanceId);
      return "temporary_error";
    }
    if (!granted) {
      announce(`${providerNames[providerId]} access was not changed.`);
      setProviderOperation(prepared.instanceId);
      return "permission_declined";
    }

    try {
      setProviderOperation(prepared.instanceId, "fetching");
      const response = asApiKeyConnectionResponse(
        await browser.runtime.sendMessage({
          type: "CONNECT_API_KEY_PROVIDER",
          providerKind: providerId,
          instanceId: prepared.instanceId,
          config,
          apiKey,
          permissionIntentId: prepared.permissionIntentId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      switch (response.result) {
        case "connected":
          announce(`Connected ${providerNames[providerId]}.`);
          break;
        case "invalid_key":
          announce(`Enter a valid ${providerNames[providerId]} API key.`);
          break;
        case "insufficient_scope":
          announce(
            providerId === "elevenlabs"
              ? "Allow User → Read and check any IP restrictions, then try again."
              : "This relay key could not read its usage. Check the key and any IP restrictions.",
          );
          break;
        case "invalid_site":
          announce("This site did not return compatible New API status and usage data.");
          break;
        case "temporary_error":
          announce(`${providerNames[providerId]} could not be validated right now. Try again later.`);
          break;
      }
      return response.result;
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(`${providerNames[providerId]} could not be validated right now. Try again later.`);
      return "temporary_error";
    } finally {
      setProviderOperation(prepared.instanceId);
    }
  };

  const handleRefreshProvider = async (providerId: ConnectableProviderId) => {
    const instanceId = viewStateRef.current
      ? projectLegacyInstanceState(viewStateRef.current).instanceIds[providerId]
      : undefined;
    if (!instanceId) return;
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
      announce(confirmationFailure(providerId));
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

  const handleDisconnectProvider = async (providerId: ConnectableProviderId) => {
    const instanceId = viewStateRef.current
      ? projectLegacyInstanceState(viewStateRef.current).instanceIds[providerId]
      : undefined;
    if (!instanceId) return;
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
          ? `Disconnected ${providerNames[providerId]} and deleted its stored usage.`
          : `Deleted ${providerNames[providerId]}’s local usage. Browser access could not be removed.`,
      );
    } catch {
      announce(`Couldn’t disconnect ${providerNames[providerId]}.`);
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

  const { state } = projectLegacyInstanceState(viewState);
  return (
    <Cockpit
      state={state}
      now={now}
      isRefreshing={isRefreshing}
      refreshAnnouncement={announcement.message}
      refreshAnnouncementId={announcement.id}
      autoRefreshPending={isAutoRefreshPending}
      providerOperations={projectLegacyInstanceOperations(providerOperations)}
      onDisplayModeChange={handleDisplayModeChange}
      onRefresh={() => void handleRefresh()}
      onConnectProvider={(providerId) => void handleConnectProvider(providerId)}
      onOpenApiKeySetup={handleOpenApiKeySetup}
      onSubmitApiKey={handleSubmitApiKey}
      onRefreshProvider={(providerId) => void handleRefreshProvider(providerId)}
      onAutoRefreshChange={(enabled) => void handleAutoRefreshChange(enabled)}
      onDisconnectProvider={(providerId) => void handleDisconnectProvider(providerId)}
      onDeleteLocalData={() => void handleDeleteLocalData()}
    />
  );
}
