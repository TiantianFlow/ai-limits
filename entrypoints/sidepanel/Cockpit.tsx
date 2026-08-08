import React from "react";

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
  onDisplayModeChange: (mode: DisplayMode) => void;
  onRefresh: () => void;
  onConnectProvider: (providerId: Exclude<ProviderId, "antigravity">) => void;
}

const providerNames: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  kimi: "Kimi",
  cursor: "Cursor",
  antigravity: "Antigravity",
};

const sourceNames = {
  fixture: "Demo",
  "web-session": "Live",
  oauth: "OAuth",
} as const;

const STALE_AFTER_MS = 15 * 60 * 1_000;

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
  let current = credit.used;

  if (mode === "left") {
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
    value: `${value}${limit ? ` / ${limit}` : ""} ${mode}`,
  };
}

function formatFreshness(fetchedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));

  if (minutes < 1) {
    return "Updated just now";
  }

  return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

function providerView(
  provider: ProviderRecord,
  mode: DisplayMode,
  now: number,
): ProviderCardProps {
  const snapshot = provider.snapshot;

  return {
    name: providerNames[provider.providerId],
    plan: snapshot?.planLabel ?? snapshot?.accountLabel,
    source: snapshot ? sourceNames[snapshot.source] : undefined,
    mode,
    quotas: snapshot?.windows.map((window) => quotaView(window, mode, now)) ?? [],
    credits: snapshot?.credits.map((credit) => creditView(credit, mode)) ?? [],
    freshness: snapshot ? formatFreshness(snapshot.fetchedAt, now) : undefined,
    stale: snapshot ? now - snapshot.fetchedAt > STALE_AFTER_MS : false,
    health: provider.health,
    hasSnapshot: snapshot !== undefined,
    emptyDescription:
      provider.providerId === "antigravity"
        ? "Usage data is not available yet."
        : `Check ${providerNames[provider.providerId]} using your signed-in browser session.`,
  };
}

export function Cockpit({
  state,
  now,
  onDisplayModeChange,
  onRefresh,
  onConnectProvider,
}: CockpitProps) {
  const mode = state.preferences.displayMode;

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
            aria-label="Refresh usage"
            title="Refresh usage"
          >
            <span aria-hidden="true">↻</span>
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Settings"
            title="Settings"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>
      </header>

      <section className="provider-list" aria-label="AI provider usage">
        {state.providers.map((provider) => {
          const connectableProviderId =
            provider.providerId === "antigravity" ? undefined : provider.providerId;

          return (
            <ProviderCard
              key={provider.providerId}
              {...providerView(provider, mode, now)}
              action={
                !provider.snapshot &&
                provider.health.kind !== "connecting" &&
                connectableProviderId
                  ? {
                      label: "Check session",
                      accessibleLabel: `Check ${providerNames[connectableProviderId]} session`,
                      onClick: () => onConnectProvider(connectableProviderId),
                    }
                  : undefined
              }
            />
          );
        })}
      </section>
    </main>
  );
}
