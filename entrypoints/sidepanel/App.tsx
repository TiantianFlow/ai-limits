import React, { useEffect, useRef, useState } from "react";

import {
  isProviderOperationEvent,
  type ProviderOperation,
  type RuntimeCommand,
} from "../../background/messages";
import { requestProviderPermission } from "../../background/permissions";
import type {
  AppState,
  DisplayMode,
  ProviderId,
  RefreshReport,
} from "../../domain/model";
import type { ConnectableProviderId } from "../../providers/registry";
import { loadState } from "../../storage/repository";
import { Cockpit } from "./Cockpit";

interface RefreshResponse {
  state: AppState;
  report: RefreshReport;
}

interface DeleteResponse {
  state: AppState;
  result: "deleted" | "deleted_with_permission_errors";
}

interface Announcement {
  id: number;
  message: string;
}

interface AutoRefreshGuard {
  priorValue: boolean;
}

type ProviderOperations = Partial<Record<ProviderId, ProviderOperation>>;

const providerNames: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  kimi: "Kimi",
  cursor: "Cursor",
};

function sendCommand(message: RuntimeCommand): void {
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

function asAppState(value: unknown): AppState {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 3 ||
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
      const nextState = await browser.runtime.sendMessage({
        type: "DISCONNECT_PROVIDER",
        providerId,
      } satisfies RuntimeCommand);
      setState(asAppState(nextState));
      announce(
        `Disconnected ${providerNames[providerId]} and deleted its stored usage.`,
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
      onRefreshProvider={(providerId) => void handleRefreshProvider(providerId)}
      onAutoRefreshChange={(enabled) => void handleAutoRefreshChange(enabled)}
      onDisconnectProvider={(providerId) =>
        void handleDisconnectProvider(providerId)
      }
      onDeleteLocalData={() => void handleDeleteLocalData()}
    />
  );
}
