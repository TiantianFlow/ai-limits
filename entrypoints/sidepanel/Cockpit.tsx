import React, { useEffect, useRef, useState } from "react";

import type { ProviderOperation } from "../../background/messages";
import { sanitizedFailureMessage } from "../../domain/model";
import type {
  AppState,
  BalanceMetric,
  CounterMetric,
  DisplayMode,
  ProviderId,
  ProviderRecord,
  QuotaMetric,
} from "../../domain/model";
import {
  displayRatio,
  elapsedRatio,
  paceStatus,
  type PaceStatus,
} from "../../domain/quota";
import {
  type ApiKeyProviderId,
  isApiKeyProviderId,
  providerCatalog,
  providerNames,
  providerPresentation,
} from "../../providers/catalog";
import {
  type MetricValueView,
  type ProviderCardProps,
  type QuotaView,
} from "./components/ProviderCard";
import { AppHeader } from "./components/AppHeader";
import {
  RefreshAnnouncement,
  SummaryBar,
} from "./components/SummaryBar";
import {
  navigateCockpit,
  type CockpitNavigationState,
  type CockpitScreen,
} from "./navigation";
import { AddProviderView } from "./views/AddProviderView";
import { FirstRunView } from "./views/FirstRunView";
import { HistoryView } from "./views/HistoryView";
import { OverviewView } from "./views/OverviewView";
import { ProviderDetailView } from "./views/ProviderDetailView";
import { SettingsView } from "./views/SettingsView";
import {
  ApiKeyConnectView,
  type ApiKeyConnectAttemptResult,
} from "./views/ApiKeyConnectView";
import { NewApiConnectView } from "./views/NewApiConnectView";
import { usageGroupViews } from "./usage-groups";
import { balanceMetrics, counterMetrics, quotaMetrics } from "./metrics";

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
  onOpenApiKeySetup?: (providerId: ApiKeyProviderId) => void;
  onSubmitApiKey?: (
    providerId: ApiKeyProviderId,
    apiKey: string,
    baseUrl?: string,
  ) => Promise<ApiKeyConnectAttemptResult>;
  onRefreshProvider?: (providerId: ProviderId) => void;
  onAutoRefreshChange?: (enabled: boolean) => void;
  onDisconnectProvider?: (providerId: ProviderId) => void;
  onDeleteLocalData?: () => void;
}

const STALE_AFTER_MS = 35 * 60 * 1_000;

function percent(ratio: number): number {
  return Number((ratio * 100).toFixed(4));
}

function formatDuration(
  metric: QuotaMetric,
  ratio: number,
  noun: "elapsed" | "remaining",
): string | undefined {
  const duration =
    metric.cycle?.startedAt !== undefined && metric.cycle.resetsAt !== undefined
      ? metric.cycle.resetsAt - metric.cycle.startedAt
      : metric.cycle?.durationMs;

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
  return `${points} pts ${status.kind === "ahead" ? "over" : "under"} pace`;
}

function quotaView(metric: QuotaMetric, mode: DisplayMode, now: number): QuotaView {
  const elapsed = metric.cycle ? elapsedRatio(metric.cycle, now) : undefined;
  const pace = elapsed === undefined ? undefined : paceStatus(metric.usedRatio, elapsed);
  const timeRatio = elapsed === undefined ? undefined : displayRatio(elapsed, mode);
  const timeNoun = mode === "used" ? "elapsed" : "remaining";
  const shownCount =
    metric.used !== undefined && metric.limit !== undefined
      ? mode === "used"
        ? metric.used
        : Math.max(0, metric.limit - metric.used)
      : undefined;
  const valueLabel =
    shownCount === undefined || metric.limit === undefined
      ? undefined
      : `${shownCount.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${metric.limit.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return {
    id: metric.id,
    label: metric.label,
    quotaPercent: percent(displayRatio(metric.usedRatio, mode)),
    usedPercent: percent(metric.usedRatio),
    valueLabel,
    timePercent: timeRatio === undefined ? undefined : percent(timeRatio),
    timeLabel:
      timeRatio === undefined
        ? undefined
        : formatDuration(metric, timeRatio, timeNoun),
    resetAt: metric.cycle?.resetsAt,
    resetLabel:
      metric.cycle?.resetsAt === undefined ? undefined : formatReset(metric.cycle.resetsAt),
    paceKind: pace?.kind,
    paceLabel: formatPace(pace),
    segments: metric.segments?.map((segment) => ({
      id: segment.id,
      label: segment.label,
      percent: percent(segment.usedRatio),
    })),
  };
}

function formatAmount(value: number, unit: string): string {
  if (unit === "USD") {
    return `$${value.toFixed(2)}`;
  }

  return `${value.toLocaleString()} ${unit}`;
}

function counterView(metric: CounterMetric): MetricValueView {
  const limit = metric.limit === undefined ? undefined : formatAmount(metric.limit, metric.unit);
  return {
    id: metric.id,
    label: metric.label,
    value: `${formatAmount(metric.value, metric.unit)}${limit ? ` / ${limit}` : ""} ${metric.semantic === "spent" ? "spent" : "used"}`,
  };
}

function balanceView(metric: BalanceMetric): MetricValueView {
  return {
    id: metric.id,
    label: metric.label,
    value: `${formatAmount(metric.value, metric.unit)} remaining`,
  };
}

function formatFreshness(fetchedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));

  if (minutes < 1) {
    return "Updated just now";
  }

  return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

function lastRefreshLabel(state: AppState, now: number): string {
  const latest = state.providers.reduce<number | undefined>((current, provider) => {
    const providerLatest = Math.max(
      provider.snapshot?.fetchedAt ?? -1,
      provider.lastAttempt?.finishedAt ?? -1,
    );
    return providerLatest < 0
      ? current
      : current === undefined
        ? providerLatest
        : Math.max(current, providerLatest);
  }, undefined);

  return latest === undefined
    ? "unavailable"
    : formatFreshness(latest, now).replace(/^Updated /, "");
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
        ? "Automatic refresh couldn't update Kimi. Manual Refresh may briefly open an inactive Kimi tab."
        : undefined;
    }

    return provider.providerId === "kimi"
      ? "Kimi needs a browser session."
      : "Refresh is waiting for a browser session.";
  }

  if (
    outcome.category === "temporary_error" &&
    provider.lastAttempt?.trigger === "scheduled" &&
    provider.snapshot &&
    !stale
  ) {
    return undefined;
  }

  return sanitizedFailureMessage(outcome.category, outcome.message);
}

export function providerView(
  provider: ProviderRecord,
  mode: DisplayMode,
  now: number,
): ProviderCardProps {
  const snapshot = provider.snapshot;
  const stale = snapshot ? now - snapshot.fetchedAt > STALE_AFTER_MS : false;
  const presentation = providerPresentation(provider.providerId);
  const quotas = snapshot?.metrics
    ? quotaMetrics(snapshot).map((metric) => quotaView(metric, mode, now))
    : [];
  const values = snapshot?.metrics
    ? [
        ...counterMetrics(snapshot).map(counterView),
        ...balanceMetrics(snapshot).map(balanceView),
      ]
    : [];
  const rawPlan = snapshot?.planLabel ?? snapshot?.accountLabel;
  const plan =
    provider.providerId === "chatgpt" && rawPlan?.toLowerCase() === "plus"
      ? "Plus"
      : rawPlan;

  return {
    providerId: provider.providerId,
    name: providerNames[provider.providerId],
    plan,
    mode,
    values,
    usageGroups:
      snapshot === undefined
        ? []
        : usageGroupViews(snapshot.usageGroups, quotas, values),
    freshness: snapshot ? formatFreshness(snapshot.fetchedAt, now) : undefined,
    stale,
    access: provider.access,
    attemptMessage: attemptMessage(provider, stale),
    hasSnapshot: snapshot !== undefined,
    history: snapshot
      ? {
          metrics: quotaMetrics(snapshot),
          observations: provider.history,
          now,
        }
      : undefined,
    emptyDescription:
      provider.access === "required"
        ? presentation.connectionDisclosure
        : `No ${providerNames[provider.providerId]} usage has been stored yet.`,
    extraDisclosure:
      provider.access === "required" && provider.providerId === "kimi"
        ? presentation.manualRefreshDisclosure
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
  onOpenApiKeySetup = () => undefined,
  onSubmitApiKey = async () => "temporary_error",
  onRefreshProvider = () => undefined,
  onAutoRefreshChange = () => undefined,
  onDisconnectProvider = () => undefined,
  onDeleteLocalData = () => undefined,
}: CockpitProps) {
  const mode = state.preferences.displayMode;
  const [navigation, setNavigation] = useState<CockpitNavigationState>({
    current: { name: "overview" },
    backStack: [],
  });
  const view = navigation.current;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historySelection, setHistorySelection] = useState<{
    providerId?: ProviderId;
    metrics: Partial<Record<ProviderId, string>>;
  }>({ metrics: {} });
  const cockpitRef = useRef<HTMLElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const addProviderButton = useRef<HTMLButtonElement>(null);
  const settingsAddProviderButton = useRef<HTMLButtonElement>(null);
  const focusBackStack = useRef<string[]>([]);
  const restoreFocusTarget = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    const focusKey = restoreFocusTarget.current;
    if (focusKey) {
      restoreFocusTarget.current = null;
      const staticTarget =
        focusKey === "overview-settings"
          ? settingsButton.current
          : focusKey === "overview-add-provider"
            ? addProviderButton.current
            : focusKey === "settings-add-provider"
              ? settingsAddProviderButton.current
              : undefined;
      const dynamicTarget = cockpitRef.current?.querySelector<HTMLElement>(
        `[data-focus-key="${focusKey}"]`,
      );
      (staticTarget ?? dynamicTarget)?.focus();
    }
  }, [view]);

  const pushScreen = (screen: CockpitScreen, focusKey: string) => {
    const next = navigateCockpit(navigation, { type: "push", screen });
    if (next === navigation) {
      return;
    }

    focusBackStack.current.push(focusKey);
    setConfirmDelete(false);
    setNavigation(next);
  };

  const popScreen = () => {
    const next = navigateCockpit(navigation, { type: "pop" });
    if (next === navigation) {
      return;
    }

    restoreFocusTarget.current = focusBackStack.current.pop() ?? null;
    setConfirmDelete(false);
    setNavigation(next);
  };

  const goHome = () => {
    focusBackStack.current = [];
    restoreFocusTarget.current = null;
    setConfirmDelete(false);
    setNavigation((current) => navigateCockpit(current, { type: "home" }));
  };

  const openApiKeyConnect = (
    providerId: ApiKeyProviderId,
    mode: "connect" | "replace",
  ) => {
    const focusKey =
      view.name === "settings"
        ? `settings-replace-api-key-${providerId}`
        : mode === "replace"
          ? `overview-replace-api-key-${providerId}`
          : `connect-provider-${providerId}`;
    pushScreen({ name: "api-key-connect", providerId, mode }, focusKey);
    if (providerCatalog[providerId].connection.origin === "static") {
      onOpenApiKeySetup(providerId);
    }
  };

  const connectProvider = (providerId: ProviderId) => {
    if (isApiKeyProviderId(providerId)) {
      openApiKeyConnect(providerId, "connect");
      return;
    }

    onConnectProvider(providerId);
  };

  const connectedProviders = state.providers.filter(
    (provider) => provider.access === "granted",
  );
  const disconnectedProviders = state.providers.filter(
    (provider) => provider.access !== "granted",
  );
  const overviewProviders = connectedProviders.map((provider) => {
    const { providerId: _providerId, ...card } = providerView(provider, mode, now);
    const failureCategory =
      provider.lastAttempt?.outcome.kind === "failure"
        ? provider.lastAttempt.outcome.category
        : undefined;
    return {
      providerId: provider.providerId,
      card,
      needsApiKeyReplacement:
        providerCatalog[provider.providerId].connection.kind === "api-key" &&
        (failureCategory === "credential_invalid" ||
          failureCategory === "credential_scope_required"),
    };
  });
  const isFirstRun = view.name === "overview" && connectedProviders.length === 0;
  const previousScreen = navigation.backStack.at(-1);
  const historyBackLabel =
    previousScreen?.name === "provider"
      ? providerNames[previousScreen.providerId]
      : previousScreen?.name === "overview"
        ? "Overview"
        : previousScreen?.name === "settings"
          ? "Settings"
          : "Back";
  const apiKeyBackLabel =
    previousScreen?.name === "provider"
      ? providerNames[previousScreen.providerId]
      : previousScreen?.name === "add-provider"
        ? "Add provider"
        : previousScreen?.name === "settings"
          ? "Settings"
          : "Overview";
  const detailRecord =
    view.name === "provider"
      ? state.providers.find(
          (provider) =>
            provider.providerId === view.providerId &&
            provider.access === "granted",
        )
      : undefined;
  const detailProvider = detailRecord
    ? providerView(detailRecord, mode, now)
    : undefined;
  const activeHistoryProviderId =
    historySelection.providerId ??
    (view.name === "history" ? view.providerId : undefined);
  const activeHistoryMetricId = activeHistoryProviderId
    ? historySelection.metrics[activeHistoryProviderId] ??
      (view.name === "history" && view.providerId === activeHistoryProviderId
        ? view.metricId
        : undefined)
    : undefined;
  const activeHistoryRecord = activeHistoryProviderId
    ? state.providers.find(
        (provider) =>
          provider.providerId === activeHistoryProviderId &&
          provider.access === "granted" &&
          provider.snapshot,
      )
    : undefined;
  const activeHistoryView = activeHistoryRecord
    ? providerView(activeHistoryRecord, mode, now)
    : undefined;
  const activeHistoryQuota = activeHistoryView?.usageGroups
    .flatMap((group) => group.quotas)
    .find((quota) => quota.id === activeHistoryMetricId);

  const openHistory = (
    providerId: ProviderId,
    focusKey: string,
    requestedMetricId?: string,
  ) => {
    const snapshot = state.providers.find((provider) => provider.providerId === providerId)?.snapshot;
    const providerMetrics = snapshot ? quotaMetrics(snapshot) : [];
    const explicitMetricId = providerMetrics.some(
      (metric) => metric.id === requestedMetricId,
    )
      ? requestedMetricId
      : undefined;
    const savedMetricId = historySelection.metrics[providerId];
    const validSavedMetricId = providerMetrics.some(
      (metric) => metric.id === savedMetricId,
    )
      ? savedMetricId
      : undefined;
    const metricId =
      explicitMetricId ?? validSavedMetricId ?? providerMetrics[0]?.id;
    setHistorySelection((current) => ({
      providerId,
      metrics: {
        ...current.metrics,
        ...(metricId ? { [providerId]: metricId } : {}),
      },
    }));
    pushScreen({ name: "history", providerId, metricId }, focusKey);
  };

  return (
    <main className="cockpit" ref={cockpitRef}>
      {view.name === "overview" && !isFirstRun ? (
        <AppHeader
          mode={mode}
          isRefreshing={isRefreshing}
          settingsOpen={false}
          providerCount={connectedProviders.length}
          lastRefreshLabel={lastRefreshLabel(state, now)}
          settingsButtonRef={settingsButton}
          onDisplayModeChange={onDisplayModeChange}
          onRefresh={onRefresh}
          onOpenSettings={() =>
            pushScreen({ name: "settings" }, "overview-settings")
          }
        />
      ) : null}

      {view.name === "overview" && !isFirstRun ? (
        <SummaryBar
          key={refreshAnnouncementId}
          message={refreshAnnouncement}
        />
      ) : null}

      {view.name === "api-key-connect" ? (
        view.providerId === "newapi" ? (
          <NewApiConnectView
            mode={view.mode}
            backLabel={apiKeyBackLabel}
            onBack={popScreen}
            onSubmit={async (baseUrl, apiKey) => {
              const result = await onSubmitApiKey(view.providerId, apiKey, baseUrl);
              if (result === "connected") goHome();
              return result;
            }}
          />
        ) : (
          <ApiKeyConnectView
            mode={view.mode}
            backLabel={apiKeyBackLabel}
            onBack={popScreen}
            onOpenSetup={() => onOpenApiKeySetup(view.providerId)}
            onSubmit={async (apiKey) => {
              const result = await onSubmitApiKey(view.providerId, apiKey);
              if (result === "connected") goHome();
              return result;
            }}
          />
        )
      ) : view.name === "settings" ? (
        <SettingsView
          autoRefresh={state.preferences.autoRefresh}
          autoRefreshPending={autoRefreshPending}
          providers={state.providers}
          now={now}
          confirmDelete={confirmDelete}
          addProviderButtonRef={settingsAddProviderButton}
          closeLabel={
            previousScreen?.name === "provider"
              ? providerNames[previousScreen.providerId]
              : "Overview"
          }
          onClose={popScreen}
          onAddProvider={() =>
            pushScreen({ name: "add-provider" }, "settings-add-provider")
          }
          onAutoRefreshChange={onAutoRefreshChange}
          onDisconnectProvider={onDisconnectProvider}
          onReplaceApiKey={(providerId) =>
            openApiKeyConnect(providerId, "replace")
          }
          onDeleteLocalData={onDeleteLocalData}
          onConfirmDeleteChange={setConfirmDelete}
        />
      ) : view.name === "add-provider" ? (
        <AddProviderView
          providers={disconnectedProviders}
          providerOperations={providerOperations}
          origin={previousScreen?.name === "settings" ? "settings" : "overview"}
          onBack={popScreen}
          onConnectProvider={connectProvider}
        />
      ) : view.name === "provider" ? (
        <ProviderDetailView
          provider={detailProvider}
          operation={providerOperations[view.providerId]}
          onBack={popScreen}
          onHome={goHome}
          onRefreshProvider={onRefreshProvider}
          onOpenHistory={(providerId, metricId, focusKey) =>
            openHistory(
              providerId,
              focusKey ?? `provider-history-${providerId}`,
              metricId ?? (detailRecord?.snapshot ? quotaMetrics(detailRecord.snapshot)[0]?.id : undefined),
            )
          }
          onOpenSettings={() =>
            pushScreen(
              { name: "settings" },
              `provider-settings-${view.providerId}`,
            )
          }
        />
      ) : view.name === "history" ? (
        <HistoryView
          providers={state.providers}
          providerId={activeHistoryProviderId ?? view.providerId}
          metricId={activeHistoryMetricId}
          metricIdsByProvider={historySelection.metrics}
          currentQuota={activeHistoryQuota}
          mode={mode}
          now={now}
          backLabel={historyBackLabel}
          onBack={popScreen}
          onDisplayModeChange={onDisplayModeChange}
          onSelectionChange={(providerId, metricId) =>
            setHistorySelection((current) => ({
              providerId,
              metrics: { ...current.metrics, [providerId]: metricId },
            }))
          }
        />
      ) : isFirstRun ? (
        <FirstRunView
          providers={disconnectedProviders}
          providerOperations={providerOperations}
          onConnectProvider={connectProvider}
        />
      ) : (
        <OverviewView
          providers={overviewProviders}
          providerOperations={providerOperations}
          addProviderButtonRef={addProviderButton}
          onAddProvider={() =>
            pushScreen({ name: "add-provider" }, "overview-add-provider")
          }
          onRefreshProvider={onRefreshProvider}
          onOpenProvider={(providerId) =>
            pushScreen(
              { name: "provider", providerId },
              `overview-provider-${providerId}`,
            )
          }
          onOpenHistory={(providerId, metricId) =>
            openHistory(
              providerId,
              `provider-history-${providerId}-${metricId}`,
              metricId,
            )
          }
          onReplaceApiKey={(providerId) =>
            openApiKeyConnect(providerId, "replace")
          }
        />
      )}
      {view.name !== "overview" || isFirstRun ? (
        <RefreshAnnouncement
          key={refreshAnnouncementId}
          message={refreshAnnouncement}
        />
      ) : null}
    </main>
  );
}
