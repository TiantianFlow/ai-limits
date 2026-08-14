import React, { useEffect, useRef, useState } from "react";

import {
  isProviderOperationEvent,
  parseApiKeyConnectionResponse,
  parseAppViewState,
  parseDeleteResponse,
  parseDisconnectResponse,
  parsePermissionIntentResponse,
  parseRefreshResponse,
  providerAvailability,
  providerNames,
  providerPresentation,
  type AppViewState,
  type ApiKeyProviderKind,
  type BrowserSessionProviderKind,
  type DisplayMode,
  type PermissionIntentResponse,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderKind,
  type ProviderOperation,
  type RefreshReport,
  type RuntimeCommand,
} from "../../domain/public-protocol";
import { Cockpit } from "./Cockpit";
import type { ApiKeySubmission } from "./Cockpit";
import { instanceLabels } from "./instance-label";
import type { ApiKeyConnectAttemptResult } from "./views/ApiKeyConnectView";

interface Announcement {
  id: number;
  message: string;
}

interface AutoRefreshGuard {
  priorValue: boolean;
}

interface RequestedViewState {
  sequence: number;
  state: AppViewState;
}

type ProviderOperations = Partial<Record<ProviderInstanceId, ProviderOperation>>;

function presentationLabel(
  state: AppViewState | undefined,
  instanceId: ProviderInstanceId,
): string | undefined {
  return state ? instanceLabels(state.instances).get(instanceId) : undefined;
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

function rawProviderConfig(
  state: AppViewState,
  providerKind: ProviderKind,
  baseUrl?: string,
): ProviderInstanceConfig {
  return providerAvailability(state, providerKind).configKind === "dynamic-origin"
    ? { kind: "dynamic-origin", baseUrl: baseUrl ?? "" }
    : { kind: "fixed" };
}

export function App() {
  const [viewState, setViewState] = useState<AppViewState>();
  const viewStateRef = useRef<AppViewState | undefined>(undefined);
  const stateRequestSequence = useRef(0);
  const appliedStateRequestSequence = useRef(0);
  const displayMutationSequence = useRef(0);
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

  const requestViewState = async (): Promise<RequestedViewState> => {
    const sequence = ++stateRequestSequence.current;
    return {
      sequence,
      state: parseAppViewState(
        await browser.runtime.sendMessage({ type: "GET_STATE" }),
      ),
    };
  };

  const applyRequestedViewState = (
    requested: RequestedViewState,
    project: (state: AppViewState) => AppViewState = (state) => state,
  ): boolean => {
    if (requested.sequence <= appliedStateRequestSequence.current) return false;
    appliedStateRequestSequence.current = requested.sequence;
    commitViewState(project(requested.state));
    return true;
  };

  useEffect(() => {
    let mounted = true;

    const reloadView = async () => {
      const requested = await requestViewState();
      if (mounted && applyRequestedViewState(requested)) {
        setLoadFailed(false);
      }
      return requested;
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
      void requestViewState()
        .then((requested) => {
          if (
            !mounted ||
            guardAtEvent !== autoRefreshGuard.current
          )
            return;
          const activeGuard = autoRefreshGuard.current;
          applyRequestedViewState(requested, (nextState) =>
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
    const prior = viewStateRef.current;
    if (!prior) return;
    const mutation = ++displayMutationSequence.current;
    clearAnnouncement();
    commitViewState({
      ...prior,
      preferences: { ...prior.preferences, displayMode: mode },
    });
    void browser.runtime
      .sendMessage({ type: "SET_DISPLAY_MODE", mode } satisfies RuntimeCommand)
      .then(parseAppViewState)
      .then((next) => {
        if (mutation === displayMutationSequence.current) commitViewState(next);
      })
      .catch(async () => {
        if (mutation !== displayMutationSequence.current) return;
        try {
          const requested = await requestViewState();
          if (mutation === displayMutationSequence.current) {
            applyRequestedViewState(requested);
          }
        } catch {
          const current = viewStateRef.current;
          if (current && mutation === displayMutationSequence.current) {
            commitViewState({
              ...current,
              preferences: {
                ...current.preferences,
                displayMode: prior.preferences.displayMode,
              },
            });
          }
        }
        if (mutation === displayMutationSequence.current) {
          announce("Couldn’t update the display mode.");
        }
      });
  };

  const abandonPermissionIntent = async (permissionIntentId: string) => {
    try {
      commitViewState(
        parseAppViewState(
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
    const prepared = parsePermissionIntentResponse(
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
        parseAppViewState(
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
    const currentState = viewStateRef.current;
    if (
      !currentState ||
      providerAvailability(currentState, providerKind).credentialKind !== "none"
    ) return;
    clearAnnouncement();
    const config = rawProviderConfig(currentState, providerKind);
    const existingInstanceId = currentState.instances.find(
      (instance) => instance.providerKind === providerKind,
    )?.id;
    let prepared: PermissionIntentResponse;
    try {
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
      const response = parseRefreshResponse(
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
    const setupUrl = providerPresentation(providerKind).apiKeySetupUrl;
    if (!setupUrl) return;
    void browser.tabs.create({ url: setupUrl }).catch(() => {
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
    const submittedLabel =
      (instanceId
        ? presentationLabel(viewStateRef.current, instanceId)
        : userLabel?.trim()) || providerNames[providerKind];
    const currentState = viewStateRef.current;
    if (!currentState) return "temporary_error";
    const config = rawProviderConfig(currentState, providerKind, baseUrl);
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
      announce(`${submittedLabel} could not be validated right now. Try again later.`);
      return "temporary_error";
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(`${submittedLabel} could not be validated right now. Try again later.`);
      setProviderOperation(prepared.instanceId);
      return "temporary_error";
    }
    if (!granted) {
      announce(`${submittedLabel} access was not changed.`);
      setProviderOperation(prepared.instanceId);
      return "permission_declined";
    }

    try {
      setProviderOperation(prepared.instanceId, "fetching");
      const response = parseApiKeyConnectionResponse(
        await browser.runtime.sendMessage({
          type: "CONNECT_API_KEY_PROVIDER",
          providerKind,
          instanceId: prepared.instanceId,
          ...(userLabel !== undefined ? { userLabel } : {}),
          config: prepared.normalizedConfig,
          apiKey,
          permissionIntentId: prepared.permissionIntentId,
        } satisfies RuntimeCommand),
      );
      commitViewState(response.state);
      switch (response.result) {
        case "connected":
          announce(
            `Connected ${presentationLabel(response.state, prepared.instanceId) ?? submittedLabel}.`,
          );
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
          announce(`${submittedLabel} could not be validated right now. Try again later.`);
          break;
      }
      return response.result;
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(`${submittedLabel} could not be validated right now. Try again later.`);
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
    const label = presentationLabel(viewStateRef.current, instanceId);
    clearAnnouncement();
    setProviderOperation(instanceId, "fetching");
    try {
      const response = parseRefreshResponse(
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
      const response = parseRefreshResponse(
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
      const authoritative = parseAppViewState(
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
        const requested = await requestViewState();
        applyRequestedViewState(requested);
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
    const label = presentationLabel(viewStateRef.current, instanceId)!;
    clearAnnouncement();
    try {
      const response = parseDisconnectResponse(
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
    if (!current) return false;
    const currentLabel = presentationLabel(viewStateRef.current, instanceId)!;
    clearAnnouncement();
    try {
      const next = parseAppViewState(
        await browser.runtime.sendMessage({
          type: "RENAME_INSTANCE",
          instanceId,
          ...(userLabel ? { userLabel } : {}),
        } satisfies RuntimeCommand),
      );
      commitViewState(next);
      announce(
        `Renamed connection to ${presentationLabel(next, instanceId) ?? currentLabel}.`,
      );
      return true;
    } catch {
      announce(`Couldn’t rename ${currentLabel}.`);
      return false;
    }
  };

  const handleDeleteLocalData = async () => {
    clearAnnouncement();
    try {
      const response = parseDeleteResponse(
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
      onRenameInstance={handleRenameInstance}
      onDeleteLocalData={() => void handleDeleteLocalData()}
    />
  );
}
