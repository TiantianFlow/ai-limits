import React, { useEffect, useRef, useState } from "react";

import {
  isProviderOperationEvent,
  type ProviderOperation,
  type RuntimeCommand,
} from "../../background/messages";
import type {
  ApiKeyConnectionResult,
  ApiKeyConnectionStatus,
} from "../../background/api-key-connection";
import { requestProviderPermission } from "../../background/permissions";
import type { DisconnectProviderResult } from "../../background/coordinator";
import type {
  AppState,
  DisplayMode,
  ProviderId,
  RefreshReport,
} from "../../domain/model";
import type { ConnectableProviderId } from "../../providers/registry";
import {
  type ApiKeyProviderId,
  providerCatalog,
  providerNames,
} from "../../providers/catalog";
import { loadState } from "../../storage/repository";
import { Cockpit } from "./Cockpit";
import type { ApiKeyConnectAttemptResult } from "./views/ApiKeyConnectView";

interface RefreshResponse {
  state: AppState;
  report: RefreshReport;
}

interface DeleteResponse {
  state: AppState;
  result: "deleted" | "deleted_with_permission_errors";
}

interface DisconnectResponse {
  state: AppState;
  result: DisconnectProviderResult;
}

interface Announcement {
  id: number;
  message: string;
}

interface AutoRefreshGuard {
  priorValue: boolean;
}

type ProviderOperations = Partial<Record<ProviderId, ProviderOperation>>;

function sendCommand(message: RuntimeCommand): void {
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

function asAppState(value: unknown): AppState {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 4 ||
    !("preferences" in value) ||
    !value.preferences ||
    typeof value.preferences !== "object" ||
    !("providers" in value) ||
    !Array.isArray(value.providers)
  ) {
    throw new Error("Missing application state");
  }

  return value as AppState;
}

function manualSummary(report: RefreshReport): string {
  const attempted = Object.entries(report.providers).filter(
    ([, outcome]) =>
      outcome &&
      !(outcome.kind === "skipped" && outcome.reason === "permission_required"),
  );
  if (attempted.length === 0) {
    return "Connect a provider before refreshing.";
  }

  const successes = attempted.filter(
    ([, outcome]) => outcome?.kind === "success",
  );
  if (successes.length === attempted.length) {
    return `Updated ${successes.length} provider${successes.length === 1 ? "" : "s"}.`;
  }

  if (successes.length === 0) {
    return "No providers updated. Existing data is unchanged.";
  }

  const nonSuccesses = attempted.filter(
    ([, outcome]) => outcome?.kind !== "success",
  );
  const kimiIsOnlyNonSuccess =
    nonSuccesses.length === 1 &&
    nonSuccesses[0]?.[0] === "kimi" &&
    nonSuccesses[0]?.[1]?.kind === "deferred" &&
    nonSuccesses[0][1].reason === "session_required";

  return `Updated ${successes.length} of ${attempted.length}. ${
    kimiIsOnlyNonSuccess
      ? "Kimi needs a browser session."
      : "Some providers need attention."
  }`;
}

function confirmationFailure(providerId?: ProviderId): string {
  const subject = providerId
    ? `${providerNames[providerId]} refresh`
    : "refresh";
  return `Couldn’t confirm the ${subject} result. Check the latest usage before retrying.`;
}

function asRefreshResponse(value: unknown): RefreshResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("state" in value) ||
    !("report" in value)
  ) {
    throw new Error("Missing refresh response");
  }

  const response = value as Record<string, unknown>;
  return {
    state: asAppState(response.state),
    report: response.report as RefreshReport,
  };
}

function asDeleteResponse(value: unknown): DeleteResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("state" in value) ||
    !("result" in value) ||
    (value.result !== "deleted" &&
      value.result !== "deleted_with_permission_errors")
  ) {
    throw new Error("Missing delete response");
  }

  return {
    state: asAppState(value.state),
    result: value.result,
  };
}

function asDisconnectResponse(value: unknown): DisconnectResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("state" in value) ||
    !("result" in value) ||
    !value.result ||
    typeof value.result !== "object" ||
    !("ok" in value.result) ||
    !("localDataDeleted" in value.result) ||
    value.result.localDataDeleted !== true ||
    (value.result.ok !== true &&
      (value.result.ok !== false ||
        !("error" in value.result) ||
        value.result.error !== "permission_removal_failed"))
  ) {
    throw new Error("Missing disconnect response");
  }

  return {
    state: asAppState(value.state),
    result: value.result as DisconnectProviderResult,
  };
}

const apiKeyConnectionStatuses = new Set<ApiKeyConnectionStatus>([
  "connected",
  "invalid_key",
  "insufficient_scope",
  "invalid_site",
  "temporary_error",
]);

function asApiKeyConnectionResponse(value: unknown): ApiKeyConnectionResult {
  if (
    !value ||
    typeof value !== "object" ||
    !("state" in value) ||
    !("report" in value) ||
    !("result" in value) ||
    typeof value.result !== "string" ||
    !apiKeyConnectionStatuses.has(value.result as ApiKeyConnectionStatus)
  ) {
    throw new Error("Missing API key connection response");
  }

  return {
    state: asAppState(value.state),
    report: value.report as RefreshReport,
    result: value.result as ApiKeyConnectionStatus,
  };
}

export function App() {
  const [state, setState] = useState<AppState>();
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

  useEffect(() => {
    let mounted = true;

    void browser.runtime.sendMessage({ type: "GET_STATE" }).then(
      (nextState) => {
        if (mounted) {
          try {
            setState(asAppState(nextState));
          } catch {
            setLoadFailed(true);
          }
        }
      },
      () => {
        if (mounted) {
          setLoadFailed(true);
        }
      },
    );

    const handleStorageChange = (
      _changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") {
        return;
      }

      const guardAtEvent = autoRefreshGuard.current;
      void loadState().then((nextState) => {
        if (mounted && nextState) {
          const activeGuard = autoRefreshGuard.current;
          if (guardAtEvent && guardAtEvent !== activeGuard) {
            return;
          }

          setState(
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
        }
      });
    };
    const handleRuntimeMessage = (message: unknown) => {
      if (!isProviderOperationEvent(message)) {
        return false;
      }

      setProviderOperations((current) =>
        current.kimi === "fetching"
          ? { ...current, kimi: message.operation }
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
    providerId: ProviderId,
    operation?: ProviderOperation,
  ) => {
    setProviderOperations((current) => {
      const next = { ...current };
      if (operation) {
        next[providerId] = operation;
      } else {
        delete next[providerId];
      }
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
    setState((current) =>
      current
        ? {
            ...current,
            preferences: { ...current.preferences, displayMode: mode },
          }
        : current,
    );
    sendCommand({ type: "SET_DISPLAY_MODE", mode });
  };

  const handleConnectProvider = async (providerId: ConnectableProviderId) => {
    clearAnnouncement();
    setProviderOperation(providerId, "requesting_permission");

    let granted: boolean;
    try {
      granted = await requestProviderPermission(providerId);
    } catch {
      announce(
        `Couldn’t connect ${providerNames[providerId]}. Reload AI Limits and try again.`,
      );
      setProviderOperation(providerId);
      return;
    }

    if (!granted) {
      announce(`${providerNames[providerId]} was not connected.`);
      setProviderOperation(providerId);
      return;
    }

    try {
      setProviderOperation(providerId, "fetching");
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({
          type: "COLLECT_PROVIDER",
          providerId,
        } satisfies RuntimeCommand),
      );
      setState(response.state);
      announce(manualSummary(response.report));
    } catch {
      announce(confirmationFailure(providerId));
    } finally {
      setProviderOperation(providerId);
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
    const connectionIntent =
      state?.providers.find((provider) => provider.providerId === providerId)
        ?.access === "granted"
        ? "replacement"
        : "permission-grant";
    clearAnnouncement();
    setProviderOperation(providerId, "requesting_permission");
    let granted: boolean;
    try {
      granted = await requestProviderPermission(providerId, { baseUrl });
    } catch {
      announce(`${providerNames[providerId]} could not be validated right now. Try again later.`);
      setProviderOperation(providerId);
      return "temporary_error";
    }

    if (!granted) {
      announce(`${providerNames[providerId]} access was not changed.`);
      setProviderOperation(providerId);
      return "permission_declined";
    }

    try {
      setProviderOperation(providerId, "fetching");
      const response = asApiKeyConnectionResponse(
        await browser.runtime.sendMessage({
          type: "CONNECT_API_KEY_PROVIDER",
          providerId,
          apiKey,
          ...(baseUrl ? { baseUrl } : {}),
          connectionIntent,
        } satisfies RuntimeCommand),
      );
      setState(response.state);
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
      announce(`${providerNames[providerId]} could not be validated right now. Try again later.`);
      return "temporary_error";
    } finally {
      setProviderOperation(providerId);
    }
  };

  const handleRefreshProvider = async (providerId: ConnectableProviderId) => {
    clearAnnouncement();
    setProviderOperation(providerId, "fetching");
    try {
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({
          type: "REFRESH_PROVIDER",
          providerId,
        } satisfies RuntimeCommand),
      );
      setState(response.state);
      announce(manualSummary(response.report));
    } catch {
      announce(confirmationFailure(providerId));
    } finally {
      setProviderOperation(providerId);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing || !state) {
      return;
    }

    setIsRefreshing(true);
    clearAnnouncement();
    setProviderOperations(
      Object.fromEntries(
        state.providers
          .filter((provider) => provider.access === "granted")
          .map((provider) => [provider.providerId, "fetching"] as const),
      ),
    );

    try {
      const response = asRefreshResponse(
        await browser.runtime.sendMessage({
          type: "REFRESH_ALL",
        } satisfies RuntimeCommand),
      );
      setState(response.state);
      announce(manualSummary(response.report));
    } catch {
      announce(confirmationFailure());
    } finally {
      setProviderOperations({});
      setIsRefreshing(false);
    }
  };

  const handleAutoRefreshChange = async (enabled: boolean) => {
    if (!state || autoRefreshGuard.current) {
      return;
    }

    const guard = { priorValue: state.preferences.autoRefresh };
    autoRefreshGuard.current = guard;
    clearAnnouncement();
    setIsAutoRefreshPending(true);
    try {
      const nextState = await browser.runtime.sendMessage({
        type: "SET_AUTO_REFRESH",
        enabled,
      } satisfies RuntimeCommand);
      const authoritative = asAppState(nextState);
      if (autoRefreshGuard.current === guard) {
        autoRefreshGuard.current = undefined;
        setState(authoritative);
      }
      announce(`Automatic refresh turned ${enabled ? "on" : "off"}.`);
    } catch {
      if (autoRefreshGuard.current === guard) {
        autoRefreshGuard.current = undefined;
      }
      const authoritative = await loadState().catch(() => undefined);
      if (authoritative) {
        setState(authoritative);
      }
      announce("Couldn’t update automatic refresh.");
    } finally {
      setIsAutoRefreshPending(false);
    }
  };

  const handleDisconnectProvider = async (providerId: ConnectableProviderId) => {
    clearAnnouncement();
    try {
      const response = asDisconnectResponse(
        await browser.runtime.sendMessage({
          type: "DISCONNECT_PROVIDER",
          providerId,
        } satisfies RuntimeCommand),
      );
      setState(response.state);
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
      setState(response.state);
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

  if (!state) {
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
      state={state}
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
      onRefreshProvider={(providerId) => void handleRefreshProvider(providerId)}
      onAutoRefreshChange={(enabled) => void handleAutoRefreshChange(enabled)}
      onDisconnectProvider={(providerId) =>
        void handleDisconnectProvider(providerId)
      }
      onDeleteLocalData={() => void handleDeleteLocalData()}
    />
  );
}
