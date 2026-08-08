import React, { useEffect, useState } from "react";

import type { RuntimeCommand } from "../../background/messages";
import type { AppState, DisplayMode, ProviderId } from "../../domain/model";
import {
  ensureState,
  loadState,
  setDisplayMode,
} from "../../storage/repository";
import { Cockpit } from "./Cockpit";

type ConnectProviderCommand = {
  type: "CONNECT_PROVIDER";
  providerId: Exclude<ProviderId, "antigravity">;
};

function sendMessage(message: RuntimeCommand | ConnectProviderCommand): void {
  void browser.runtime.sendMessage(message);
}

export function App() {
  const [state, setState] = useState<AppState>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;

    void ensureState(Date.now()).then((nextState) => {
      if (mounted) {
        setState(nextState);
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
    void setDisplayMode(mode);
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
        sendMessage({ type: "CONNECT_PROVIDER", providerId })
      }
    />
  );
}
