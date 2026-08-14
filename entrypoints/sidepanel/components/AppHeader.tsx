import type { Ref } from "react";
import React from "react";

import type { DisplayMode } from "../../../domain/public-protocol";
import { Icon } from "./Icon";

export interface AppHeaderProps {
  mode: DisplayMode;
  isRefreshing: boolean;
  settingsOpen: boolean;
  providerCount: number;
  lastRefreshLabel: string;
  settingsButtonRef: Ref<HTMLButtonElement>;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onRefresh: () => void;
  onOpenSettings: (invoker: HTMLButtonElement) => void;
}

export function AppHeader({
  mode,
  isRefreshing,
  settingsOpen,
  providerCount,
  lastRefreshLabel,
  settingsButtonRef,
  onDisplayModeChange,
  onRefresh,
  onOpenSettings,
}: AppHeaderProps) {
  return (
    <header className="app-header app-header--compact">
      <div
        className="segmented-control"
        role="radiogroup"
        aria-label="Show used or left"
      >
        {(["used", "left"] as const).map((option) => (
          <button
            key={option}
            role="radio"
            type="button"
            aria-checked={mode === option}
            onClick={() => onDisplayModeChange(option)}
          >
            <span className="segmented-control__option">
              {option === "used" ? "Used" : "Left"}
            </span>
          </button>
        ))}
      </div>
      <p className="app-header__status" aria-live="polite">
        {isRefreshing
          ? "Refreshing providers…"
          : `Last refresh ${lastRefreshLabel} · ${providerCount} provider${providerCount === 1 ? "" : "s"}`}
      </p>
      <div className="app-actions">
        <button
          className="icon-button"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
          aria-label={isRefreshing ? "Refreshing usage" : "Refresh usage"}
          title={isRefreshing ? "Refreshing usage" : "Refresh usage"}
        >
          <span className="control-surface">
            <Icon
              name="refresh"
              className={isRefreshing ? "icon--spin" : ""}
            />
          </span>
        </button>
        <button
          ref={settingsButtonRef}
          className="icon-button"
          type="button"
          aria-label="Settings"
          title="Settings"
          aria-expanded={settingsOpen}
          onClick={(event) => onOpenSettings(event.currentTarget)}
        >
          <span className="control-surface">
            <Icon name="settings" />
          </span>
        </button>
      </div>
    </header>
  );
}
