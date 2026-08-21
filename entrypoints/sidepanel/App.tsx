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
import { l10n, type AnnouncementTone } from "../../i18n/index";
import { localizeProviderName } from "../../i18n/presentation";
import { Cockpit } from "./Cockpit";
import type { ApiKeySubmission } from "./Cockpit";
import { instanceLabels } from "./instance-label";
import type { ApiKeyConnectAttemptResult } from "./views/ApiKeyConnectView";

interface Announcement {
  id: number;
  message: string;
  tone: AnnouncementTone;
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

function manualSummary(
  report: RefreshReport,
  state: AppViewState,
): { message: string; tone: AnnouncementTone } {
  const attempted = report.results.filter(
    ({ outcome }) =>
      !(outcome.kind === "skipped" && outcome.reason === "permission_required"),
  );
  if (attempted.length === 0) {
    return {
      message: l10n.t("refresh.connectBeforeRefreshing"),
      tone: "attention",
    };
  }

  const successes = attempted.filter(({ outcome }) => outcome.kind === "success");
  if (successes.length === attempted.length) {
    return {
      message: l10n.count("refresh.updatedProviders", successes.length),
      tone: "success",
    };
  }
  if (successes.length === 0) {
    return {
      message: l10n.t("refresh.noneUpdated"),
      tone: "attention",
    };
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

  return {
    message: l10n.t("refresh.updatedOfAttempted", {
      successCount: successes.length,
      attemptedCount: attempted.length,
      detail: kimiIsOnlyNonSuccess
        ? l10n.t("refresh.kimiNeedsSession")
        : l10n.t("refresh.someNeedAttention"),
    }),
    tone: "attention",
  };
}

function confirmationFailure(label?: string): string {
  const subject = label
    ? l10n.t("refresh.confirmationSubjectNamed", { label })
    : l10n.t("refresh.confirmationSubjectRefresh");
  return l10n.t("refresh.confirmationFailure", { subject });
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
    tone: "success",
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
    setAnnouncement((current) => ({
      id: current.id + 1,
      message: "",
      tone: "success",
    }));
  };

  const announce = (
    message: string,
    tone: AnnouncementTone = "success",
  ) => {
    setAnnouncement((current) => ({ id: current.id + 1, message, tone }));
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
          announce(l10n.t("refresh.displayModeFailed"), "attention");
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
      announce(
        l10n.t("announcements.connectFailed", {
          provider: localizeProviderName(providerKind),
        }),
        "attention",
      );
      return;
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(
        l10n.t("announcements.connectFailed", {
          provider: localizeProviderName(providerKind),
        }),
        "attention",
      );
      setProviderOperation(prepared.instanceId);
      return;
    }
    if (!granted) {
      announce(
        l10n.t("announcements.notConnected", {
          provider: localizeProviderName(providerKind),
        }),
        "attention",
      );
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
      const summary = manualSummary(response.report, response.state);
      announce(summary.message, summary.tone);
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(
        confirmationFailure(localizeProviderName(providerKind)),
        "attention",
      );
    } finally {
      setProviderOperation(prepared.instanceId);
    }
  };

  const handleOpenApiKeySetup = (providerKind: ApiKeyProviderKind) => {
    const setupUrl = providerPresentation(providerKind).apiKeySetupUrl;
    if (!setupUrl) return;
    void browser.tabs.create({ url: setupUrl }).catch(() => {
      announce(l10n.t("announcements.openApiKeysFailed"), "attention");
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
        : userLabel?.trim()) || localizeProviderName(providerKind);
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
      announce(
        l10n.t("announcements.validationTemporary", { label: submittedLabel }),
        "attention",
      );
      return "temporary_error";
    }
    setProviderOperation(prepared.instanceId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestPreparedPermission(prepared);
    } catch {
      announce(
        l10n.t("announcements.validationTemporary", { label: submittedLabel }),
        "attention",
      );
      setProviderOperation(prepared.instanceId);
      return "temporary_error";
    }
    if (!granted) {
      announce(
        l10n.t("announcements.accessUnchanged", { label: submittedLabel }),
        "attention",
      );
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
            l10n.t("announcements.connected", {
              label:
                presentationLabel(response.state, prepared.instanceId) ??
                submittedLabel,
            }),
          );
          break;
        case "invalid_key":
          announce(
            l10n.t("announcements.invalidKeyNamed", {
              provider: localizeProviderName(providerKind),
            }),
            "attention",
          );
          break;
        case "insufficient_scope":
          announce(
            providerKind === "elevenlabs"
              ? l10n.t("announcements.elevenlabsScope")
              : l10n.t("announcements.newapiScope"),
            "attention",
          );
          break;
        case "invalid_site":
          announce(l10n.t("announcements.invalidSite"), "attention");
          break;
        case "temporary_error":
          announce(
            l10n.t("announcements.validationTemporary", { label: submittedLabel }),
            "attention",
          );
          break;
      }
      return response.result;
    } catch {
      await abandonPermissionIntent(prepared.permissionIntentId);
      announce(
        l10n.t("announcements.validationTemporary", { label: submittedLabel }),
        "attention",
      );
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
      const summary = manualSummary(response.report, response.state);
      announce(summary.message, summary.tone);
    } catch {
      announce(confirmationFailure(label), "attention");
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
      const summary = manualSummary(response.report, response.state);
      announce(summary.message, summary.tone);
    } catch {
      announce(confirmationFailure(), "attention");
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
      announce(
        enabled
          ? l10n.t("announcements.autoRefreshOn")
          : l10n.t("announcements.autoRefreshOff"),
      );
    } catch {
      if (autoRefreshGuard.current === guard) autoRefreshGuard.current = undefined;
      try {
        const requested = await requestViewState();
        applyRequestedViewState(requested);
      } catch {
        // The prior rendered view remains authoritative enough for recovery.
      }
      announce(l10n.t("announcements.autoRefreshFailed"), "attention");
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
          ? l10n.t("announcements.disconnected", { label })
          : l10n.t("announcements.disconnectedPartial", { label }),
        response.result.ok ? "success" : "attention",
      );
    } catch {
      announce(l10n.t("announcements.disconnectFailed", { label }), "attention");
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
        l10n.t("announcements.renamed", {
          label: presentationLabel(next, instanceId) ?? currentLabel,
        }),
      );
      return true;
    } catch {
      announce(
        l10n.t("announcements.renameFailed", { label: currentLabel }),
        "attention",
      );
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
          ? l10n.t("announcements.localDataDeleted")
          : l10n.t("announcements.localDataPartial"),
        response.result === "deleted" ? "success" : "attention",
      );
    } catch {
      announce(l10n.t("announcements.localDataFailed"), "attention");
    }
  };

  if (!viewState) {
    if (loadFailed) {
      return (
        <main className="loading-state">
          <p>{l10n.t("loading.failed")}</p>
          <button
            className="button button--secondary"
            type="button"
            aria-label={l10n.t("loading.retry")}
            onClick={() => {
              setLoadFailed(false);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            {l10n.t("common.retry")}
          </button>
        </main>
      );
    }
    return <main className="loading-state">{l10n.t("loading.loading")}</main>;
  }

  return (
    <Cockpit
      state={viewState}
      now={now}
      isRefreshing={isRefreshing}
      refreshAnnouncement={announcement.message}
      refreshAnnouncementTone={announcement.tone}
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
