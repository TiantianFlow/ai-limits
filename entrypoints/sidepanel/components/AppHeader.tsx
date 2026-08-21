import type { Ref } from "react";
import React from "react";

import { l10n } from "../../../i18n/index";
import { localizeDisplayMode } from "../../../i18n/presentation";
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
  const refreshLabel = isRefreshing
    ? l10n.t("header.refreshingUsage")
    : l10n.t("header.refreshUsage");

  return (
    <header className="app-header app-header--compact">
      <div
        className="segmented-control"
        role="radiogroup"
        aria-label={l10n.t("navigation.showUsedOrLeft")}
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
              {localizeDisplayMode(option)}
            </span>
          </button>
        ))}
      </div>
      <p className="app-header__status" aria-live="polite">
        {isRefreshing
          ? l10n.t("header.refreshingProviders")
          : l10n.t("header.lastRefresh", {
              age: lastRefreshLabel,
              providers: l10n.count("header.providerCount", providerCount),
            })}
      </p>
      <div className="app-actions">
        <button
          className="icon-button"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
          aria-label={refreshLabel}
          title={refreshLabel}
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
          aria-label={l10n.t("common.settings")}
          title={l10n.t("common.settings")}
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
