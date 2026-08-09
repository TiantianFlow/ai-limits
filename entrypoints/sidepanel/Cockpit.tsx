import React, { useRef, useState } from "react";

import type { ProviderOperation } from "../../background/messages";
import { sanitizedFailureMessage } from "../../domain/model";
import type {
  AppState,
  CreditBalance,
  DisplayMode,
  ProviderId,
  ProviderRecord,
  QuotaWindow,
} from "../../domain/model";
import {
  displayRatio,
  elapsedRatio,
  paceStatus,
  type PaceStatus,
} from "../../domain/quota";
import {
  ProviderCard,
  type CreditView,
  type ProviderCardProps,
  type QuotaView,
} from "./components/ProviderCard";

export interface CockpitProps {
  state: AppState;
  now: number;
  isRefreshing?: boolean;
  refreshAnnouncement?: string;
  refreshAnnouncementId?: number;
  autoRefreshPending?: boolean;
  providerOperations?: Partial<Record<ProviderId, ProviderOperation>>;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onRefresh: () => void;
  onConnectProvider: (providerId: ProviderId) => void;
  onRefreshProvider?: (providerId: ProviderId) => void;
  onAutoRefreshChange?: (enabled: boolean) => void;
  onDisconnectProvider?: (providerId: ProviderId) => void;
  onDeleteLocalData?: () => void;
}

const providerNames: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  kimi: "Kimi",
  cursor: "Cursor",
};

const STALE_AFTER_MS = 35 * 60 * 1_000;
const CONNECT_DISCLOSURE =
  "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.";
const KIMI_DISCLOSURE =
  "A manual refresh may briefly open an inactive Kimi tab.";

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

function formatDuration(
  window: QuotaWindow,
  ratio: number,
  noun: "elapsed" | "left",
): string | undefined {
  const duration =
    window.startedAt !== undefined && window.resetsAt !== undefined
      ? window.resetsAt - window.startedAt
      : window.durationMs;

  if (!duration || duration <= 0) {
    return undefined;
  }

  const hour = 60 * 60 * 1_000;
  const day = 24 * hour;
  const unitMs = duration >= day ? day : hour;
  const unit = duration >= day ? "days" : "hours";
  const total = Math.round(duration / unitMs);
  const amount = Math.round((duration * ratio) / unitMs);

  return `${amount} / ${total} ${unit} ${noun}`;
}

function formatReset(resetsAt: number): string {
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(resetsAt))}`;
}

function formatPace(status: PaceStatus | undefined): string {
  if (!status) {
    return "Pace unavailable";
  }

  if (status.kind === "on-pace") {
    return "On pace";
  }

  const points = Math.abs(status.deltaPoints);
  return `${points} point${points === 1 ? "" : "s"} ${status.kind}`;
}

function quotaView(window: QuotaWindow, mode: DisplayMode, now: number): QuotaView {
  const elapsed = elapsedRatio(window, now);
  const pace = elapsed === undefined ? undefined : paceStatus(window.usedRatio, elapsed);
  const timeRatio = elapsed === undefined ? undefined : displayRatio(elapsed, mode);
  const timeNoun = mode === "used" ? "elapsed" : "left";

  return {
    id: window.id,
    label: window.label,
    quotaPercent: percent(displayRatio(window.usedRatio, mode)),
    timePercent: timeRatio === undefined ? undefined : percent(timeRatio),
    timeLabel:
      timeRatio === undefined
        ? undefined
        : formatDuration(window, timeRatio, timeNoun),
    resetAt: window.resetsAt,
    resetLabel:
      window.resetsAt === undefined ? undefined : formatReset(window.resetsAt),
    paceKind: pace?.kind,
    paceLabel: formatPace(pace),
  };
}

function formatAmount(value: number, unit: string): string {
  if (unit === "USD") {
    return `$${value.toFixed(2)}`;
  }

  return `${value.toLocaleString()} ${unit}`;
}

function creditView(credit: CreditBalance, mode: DisplayMode): CreditView {
  const isAbsoluteBalance =
    credit.used === undefined &&
    credit.limit === undefined &&
    credit.remaining !== undefined;
  let current = isAbsoluteBalance ? credit.remaining : credit.used;

  if (!isAbsoluteBalance && mode === "left") {
    current =
      credit.remaining ??
      (credit.limit !== undefined && credit.used !== undefined
        ? Math.max(0, credit.limit - credit.used)
        : undefined);
  }

  const value = current === undefined ? "Not reported" : formatAmount(current, credit.unit);
  const limit =
    credit.limit === undefined ? undefined : formatAmount(credit.limit, credit.unit);

  return {
    id: credit.id,
    label: credit.label,
    value: `${value}${limit ? ` / ${limit}` : ""}${isAbsoluteBalance ? "" : ` ${mode}`}`,
  };
}

function formatFreshness(fetchedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));

  if (minutes < 1) {
    return "Updated just now";
  }

  return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

function attemptMessage(
  provider: ProviderRecord,
  stale: boolean,
): string | undefined {
  const outcome = provider.lastAttempt?.outcome;
  if (!outcome || outcome.kind === "success") {
    return undefined;
  }

  if (outcome.kind === "deferred") {
    if (outcome.reason === "backoff") {
      return "Refresh will retry later.";
    }

    if (
      provider.providerId === "kimi" &&
      provider.lastAttempt?.trigger === "scheduled"
    ) {
      return stale || !provider.snapshot
        ? "Auto-refresh is waiting for a Kimi session."
        : undefined;
    }

    return provider.providerId === "kimi"
      ? "Kimi needs a browser session."
      : "Refresh is waiting for a browser session.";
  }

  return sanitizedFailureMessage(outcome.category, outcome.message);
}

function providerView(
  provider: ProviderRecord,
  mode: DisplayMode,
  now: number,
): ProviderCardProps {
  const snapshot = provider.snapshot;
  const stale = snapshot ? now - snapshot.fetchedAt > STALE_AFTER_MS : false;

  return {
    name: providerNames[provider.providerId],
    plan: snapshot?.planLabel ?? snapshot?.accountLabel,
    mode,
    quotas: snapshot?.windows.map((window) => quotaView(window, mode, now)) ?? [],
    credits: snapshot?.credits.map((credit) => creditView(credit, mode)) ?? [],
    freshness: snapshot ? formatFreshness(snapshot.fetchedAt, now) : undefined,
    stale,
    access: provider.access,
    attemptMessage: attemptMessage(provider, stale),
    hasSnapshot: snapshot !== undefined,
    emptyDescription:
      provider.access === "required"
        ? CONNECT_DISCLOSURE
        : `No ${providerNames[provider.providerId]} usage has been stored yet.`,
    extraDisclosure:
      provider.access === "required" && provider.providerId === "kimi"
        ? KIMI_DISCLOSURE
        : undefined,
  };
}

export function Cockpit({
  state,
  now,
  isRefreshing = false,
  refreshAnnouncement = "",
  refreshAnnouncementId = 0,
  autoRefreshPending = false,
  providerOperations = {},
  onDisplayModeChange,
  onRefresh,
  onConnectProvider,
  onRefreshProvider = () => undefined,
  onAutoRefreshChange = () => undefined,
  onDisconnectProvider = () => undefined,
  onDeleteLocalData = () => undefined,
}: CockpitProps) {
  const mode = state.preferences.displayMode;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);

  const closeSettings = () => {
    setSettingsOpen(false);
    setConfirmDelete(false);
    settingsButton.current?.focus();
  };

  return (
    <main className="cockpit">
      <header className="app-header">
        <div>
          <p className="eyebrow">Usage cockpit</p>
          <h1>AI Limits</h1>
        </div>
        <div className="app-actions">
          <div
            className="segmented-control"
            role="group"
            aria-label="Display usage as"
          >
            {(["used", "left"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => onDisplayModeChange(option)}
              >
                {option === "used" ? "Used" : "Left"}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
            aria-label={isRefreshing ? "Refreshing usage" : "Refresh usage"}
            title={isRefreshing ? "Refreshing usage" : "Refresh usage"}
          >
            {isRefreshing ? (
              <span className="refresh-spinner" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">↻</span>
            )}
          </button>
          <button
            ref={settingsButton}
            className="icon-button"
            type="button"
            aria-label="Settings"
            title="Settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen((open) => !open);
              setConfirmDelete(false);
            }}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>
      </header>

      {refreshAnnouncement ? (
        <p
          key={refreshAnnouncementId}
          className="visually-hidden"
          role="status"
          aria-live="polite"
        >
          {refreshAnnouncement}
        </p>
      ) : null}

      {settingsOpen ? (
        <section
          className="settings-panel"
          aria-labelledby="provider-settings-title"
        >
          <div className="settings-panel__heading">
            <div>
              <p className="eyebrow">Privacy and refresh</p>
              <h2 id="provider-settings-title">Provider settings</h2>
            </div>
            <button
              className="button button--secondary"
              type="button"
              aria-label="Close settings"
              onClick={closeSettings}
            >
              Close
            </button>
          </div>

          <label className="settings-toggle">
            <span>
              <strong>Automatic refresh</strong>
              <small>Refresh connected providers about every 15 minutes.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Automatic refresh"
              checked={state.preferences.autoRefresh}
              disabled={autoRefreshPending}
              aria-busy={autoRefreshPending}
              onChange={(event) =>
                onAutoRefreshChange(event.currentTarget.checked)
              }
            />
          </label>

          <section
            className="settings-group"
            aria-labelledby="connected-providers-title"
          >
            <h3 id="connected-providers-title">Connected providers</h3>
            {state.providers.some((provider) => provider.access === "granted") ? (
              <ul className="settings-provider-list">
                {state.providers
                  .filter((provider) => provider.access === "granted")
                  .map((provider) => (
                    <li key={provider.providerId}>
                      <span>{providerNames[provider.providerId]}</span>
                      <button
                        className="button button--secondary"
                        type="button"
                        aria-label={`Disconnect ${providerNames[provider.providerId]}`}
                        onClick={() => onDisconnectProvider(provider.providerId)}
                      >
                        Disconnect
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="settings-copy">No providers connected.</p>
            )}
          </section>

          <section className="danger-zone" aria-labelledby="local-data-title">
            <h3 id="local-data-title">Local data</h3>
            {confirmDelete ? (
              <div className="delete-confirmation">
                <p>This removes stored usage and disconnects every provider.</p>
                <div className="confirmation-actions">
                  <button
                    className="button button--danger"
                    type="button"
                    aria-label="Confirm delete all local data"
                    onClick={() => {
                      setConfirmDelete(false);
                      onDeleteLocalData();
                    }}
                  >
                    Confirm delete
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    aria-label="Cancel delete all local data"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button button--danger"
                type="button"
                onClick={() => setConfirmDelete(true)}
              >
                Delete all local data
              </button>
            )}
          </section>
        </section>
      ) : (
        <section className="provider-list" aria-label="AI provider usage">
          {state.providers.map((provider) => {
            const view = providerView(provider, mode, now);
            const needsKimiSession =
              provider.providerId === "kimi" &&
              provider.lastAttempt?.trigger === "scheduled" &&
              provider.lastAttempt.outcome.kind === "deferred" &&
              provider.lastAttempt.outcome.reason === "session_required" &&
              (!provider.snapshot || view.stale);
            const canConnect =
              provider.access === "required" &&
              providerOperations[provider.providerId] !==
                "requesting_permission";
            return (
              <ProviderCard
                key={provider.providerId}
                {...view}
                operation={providerOperations[provider.providerId]}
                action={
                  canConnect
                    ? {
                        label: "Connect",
                        accessibleLabel: `Connect ${providerNames[provider.providerId]}`,
                        onClick: () => onConnectProvider(provider.providerId),
                      }
                    : needsKimiSession && !providerOperations.kimi
                      ? {
                          label: "Refresh Kimi",
                          accessibleLabel: "Refresh Kimi",
                          onClick: () => onRefreshProvider("kimi"),
                        }
                      : undefined
                }
              />
            );
          })}
        </section>
      )}
    </main>
  );
}
