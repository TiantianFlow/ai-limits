import React, { useEffect, useState } from "react";

import type { RuntimeCommand } from "../../background/messages";
import { requestProviderPermission } from "../../background/permissions";
import type {
  AppState,
  DisplayMode,
  ProviderHealth,
} from "../../domain/model";
import type { ConnectableProviderId } from "../../providers/registry";
import { loadState } from "../../storage/repository";
import { Cockpit } from "./Cockpit";

function sendMessage(message: RuntimeCommand): void {
  void browser.runtime.sendMessage(message);
}

export function App() {
  const [state, setState] = useState<AppState>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;

    void browser.runtime.sendMessage({ type: "GET_STATE" }).then((nextState) => {
      if (mounted) {
        setState(nextState as AppState);
      }
    });

    const handleStorageChange = (
      _changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") {
        return;
      }

      void loadState().then((nextState) => {
        if (mounted && nextState) {
          setState(nextState);
        }
      });
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);

    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
      window.clearInterval(clock);
    };
  }, []);

  const handleDisplayModeChange = (mode: DisplayMode) => {
    setState((current) =>
      current
        ? {
            ...current,
            preferences: { ...current.preferences, displayMode: mode },
          }
        : current,
    );
    sendMessage({ type: "SET_DISPLAY_MODE", mode });
  };

  const setLocalProviderHealth = (
    providerId: ConnectableProviderId,
    health: ProviderHealth,
  ) => {
    setState((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider) =>
              provider.providerId === providerId
                ? { ...provider, health }
                : provider,
            ),
          }
        : current,
    );
  };

  const handleConnectProvider = async (providerId: ConnectableProviderId) => {
    let granted: boolean;
    setLocalProviderHealth(providerId, { kind: "connecting" });

    try {
      granted = await requestProviderPermission(providerId);
    } catch {
      setLocalProviderHealth(providerId, {
        kind: "temporary_error",
        message: "Chrome couldn't request access. Reload AI Limits and try again.",
      });
      return;
    }

    if (!granted) {
      setLocalProviderHealth(providerId, { kind: "permission_required" });
      return;
    }

    try {
      const nextState = await browser.runtime.sendMessage({
        type: "COLLECT_PROVIDER",
        providerId,
      } satisfies RuntimeCommand);

      if (!nextState) {
        throw new Error("Missing collection response");
      }

      setState(nextState as AppState);
    } catch {
      setLocalProviderHealth(providerId, {
        kind: "temporary_error",
        message: "AI Limits couldn't check this session. Reload and try again.",
      });
    }
  };

  if (!state) {
    return (
      <main className="loading-state" aria-live="polite">
        Loading usage…
      </main>
    );
  }

  return (
    <Cockpit
      state={state}
      now={now}
      onDisplayModeChange={handleDisplayModeChange}
      onRefresh={() => sendMessage({ type: "REFRESH_ALL" })}
      onConnectProvider={(providerId) =>
        void handleConnectProvider(providerId)
      }
    />
  );
}
