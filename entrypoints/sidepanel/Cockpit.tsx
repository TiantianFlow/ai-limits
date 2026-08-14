import React, { useEffect, useRef, useState } from "react";

import type {
  AppViewState,
  ProviderInstanceView,
  ProviderOperation,
} from "../../domain/public-protocol";
import type { ProviderInstanceId } from "../../domain/instances";
import { sanitizedFailureMessage } from "../../domain/model";
import type {
  BalanceMetric,
  CounterMetric,
  DisplayMode,
  QuotaMetric,
} from "../../domain/model";
import {
  displayRatio,
  elapsedRatio,
  paceStatus,
  type PaceStatus,
} from "../../domain/quota";
import {
  type ApiKeyProviderKind,
  type ProviderKind,
  canCreateProviderInstance,
  isApiKeyProviderId,
  providerCatalog,
  providerIds,
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
import { instanceLabel, instanceLabels } from "./instance-label";

export interface ApiKeySubmission {
  providerKind: ApiKeyProviderKind;
  apiKey: string;
  baseUrl?: string;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
}

export interface CockpitProps {
  state: AppViewState;
  now: number;
  isRefreshing?: boolean;
  refreshAnnouncement?: string;
  refreshAnnouncementId?: number;
  autoRefreshPending?: boolean;
  providerOperations?: Partial<Record<ProviderInstanceId, ProviderOperation>>;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onRefresh: () => void;
  onConnectProvider: (providerKind: ProviderKind) => void;
  onOpenApiKeySetup?: (providerKind: ApiKeyProviderKind) => void;
  onSubmitApiKey?: (submission: ApiKeySubmission) => Promise<ApiKeyConnectAttemptResult>;
  onRefreshInstance?: (instanceId: ProviderInstanceId) => void;
  onAutoRefreshChange?: (enabled: boolean) => void;
  onDisconnectInstance?: (instanceId: ProviderInstanceId) => void;
  onRenameInstance?: (
    instanceId: ProviderInstanceId,
    userLabel?: string,
  ) => Promise<boolean>;
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

function lastRefreshLabel(state: AppViewState, now: number): string {
  const latest = state.instances.reduce<number | undefined>((current, instance) => {
    const providerLatest = Math.max(
      instance.snapshot?.fetchedAt ?? -1,
      instance.lastAttempt?.finishedAt ?? -1,
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
  provider: ProviderInstanceView,
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
      provider.providerKind === "kimi" &&
      provider.lastAttempt?.trigger === "scheduled"
    ) {
      return stale || !provider.snapshot
        ? "Automatic refresh couldn't update Kimi. Manual Refresh may briefly open an inactive Kimi tab."
        : undefined;
    }

    return provider.providerKind === "kimi"
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
  provider: ProviderInstanceView,
  mode: DisplayMode,
  now: number,
  resolvedInstanceLabel = instanceLabel(provider),
): ProviderCardProps {
  const snapshot = provider.snapshot;
  const stale = snapshot ? now - snapshot.fetchedAt > STALE_AFTER_MS : false;
  const presentation = providerPresentation(provider.providerKind);
  const quotas = snapshot?.metrics
    ? quotaMetrics(snapshot).map((metric) => quotaView(metric, mode, now))
    : [];
  const values = snapshot?.metrics
    ? [
        ...counterMetrics(snapshot).map(counterView),
        ...balanceMetrics(snapshot).map(balanceView),
      ]
    : [];
  const rawPlan = snapshot?.planLabel;
  const plan =
    provider.providerKind === "chatgpt" && rawPlan?.toLowerCase() === "plus"
      ? "Plus"
      : rawPlan;

  return {
    instanceId: provider.id,
    instanceLabel: resolvedInstanceLabel,
    providerId: provider.providerKind,
    name: providerNames[provider.providerKind],
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
        : `No ${providerNames[provider.providerKind]} usage has been stored yet.`,
    extraDisclosure:
      provider.access === "required" && provider.providerKind === "kimi"
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
  onRefreshInstance = () => undefined,
  onAutoRefreshChange = () => undefined,
  onDisconnectInstance = () => undefined,
  onRenameInstance = async () => true,
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
    instanceId?: ProviderInstanceId;
    metrics: Partial<Record<ProviderInstanceId, string>>;
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
    providerKind: ApiKeyProviderKind,
    mode: "connect" | "replace",
    instanceId?: ProviderInstanceId,
  ) => {
    const focusKey =
      view.name === "settings"
        ? `settings-replace-api-key-${instanceId}`
        : mode === "replace"
          ? `overview-replace-api-key-${instanceId}`
          : `connect-provider-${providerKind}`;
    pushScreen(
      {
        name: "api-key-connect",
        providerKind,
        mode,
        ...(instanceId ? { instanceId } : {}),
      },
      focusKey,
    );
    if (providerCatalog[providerKind].connection.origin === "static") {
      onOpenApiKeySetup(providerKind);
    }
  };

  const connectProvider = (providerKind: ProviderKind) => {
    if (isApiKeyProviderId(providerKind)) {
      openApiKeyConnect(providerKind, "connect");
      return;
    }

    onConnectProvider(providerKind);
  };

  const connectedInstances = state.instances.filter(
    (instance) => instance.access === "granted",
  );
  const labelsByInstance = instanceLabels(state.instances);
  const availableProviderKinds = providerIds.filter((providerKind) =>
    canCreateProviderInstance(providerKind, connectedInstances),
  );
  const availableProviders = availableProviderKinds.map((providerKind) => ({
    providerKind,
    operation:
      providerCatalog[providerKind].cardinality === "single"
        ? providerOperations[`${providerKind}:default`]
        : undefined,
  }));
  const overviewProviders = connectedInstances.map((instance) => {
    const card = providerView(
      instance,
      mode,
      now,
      labelsByInstance.get(instance.id),
    );
    const failureCategory =
      instance.lastAttempt?.outcome.kind === "failure"
        ? instance.lastAttempt.outcome.category
        : undefined;
    return {
      instanceId: instance.id,
      providerKind: instance.providerKind,
      card,
      needsApiKeyReplacement:
        providerCatalog[instance.providerKind].connection.kind === "api-key" &&
        (failureCategory === "credential_invalid" ||
          failureCategory === "credential_scope_required"),
    };
  });
  const isFirstRun = view.name === "overview" && connectedInstances.length === 0;
  const previousScreen = navigation.backStack.at(-1);
  const labelForInstance = (instanceId: ProviderInstanceId): string => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    return instance ? labelsByInstance.get(instance.id) ?? instanceLabel(instance) : "Provider";
  };
  const historyBackLabel =
    previousScreen?.name === "provider"
      ? labelForInstance(previousScreen.instanceId)
      : previousScreen?.name === "overview"
        ? "Overview"
        : previousScreen?.name === "settings"
          ? "Settings"
          : "Back";
  const apiKeyBackLabel =
    previousScreen?.name === "provider"
      ? labelForInstance(previousScreen.instanceId)
      : previousScreen?.name === "add-provider"
        ? "Add provider"
      : previousScreen?.name === "settings"
          ? "Settings"
          : previousScreen?.name === "overview" &&
              connectedInstances.length === 0 &&
              view.name === "api-key-connect" &&
              view.providerKind === "newapi"
            ? "Connect your providers"
          : "Overview";
  const detailRecord =
    view.name === "provider"
      ? state.instances.find(
          (instance) =>
            instance.id === view.instanceId &&
            instance.access === "granted",
        )
      : undefined;
  const detailProvider = detailRecord
    ? providerView(detailRecord, mode, now)
    : undefined;
  const activeHistoryInstanceId =
    historySelection.instanceId ??
    (view.name === "history" ? view.instanceId : undefined);
  const activeHistoryMetricId = activeHistoryInstanceId
    ? historySelection.metrics[activeHistoryInstanceId] ??
      (view.name === "history" && view.instanceId === activeHistoryInstanceId
        ? view.metricId
        : undefined)
    : undefined;
  const activeHistoryRecord = activeHistoryInstanceId
    ? state.instances.find(
        (instance) =>
          instance.id === activeHistoryInstanceId &&
          instance.access === "granted" &&
          instance.snapshot,
      )
    : undefined;
  const activeHistoryView = activeHistoryRecord
    ? providerView(
        activeHistoryRecord,
        mode,
        now,
        labelsByInstance.get(activeHistoryRecord.id),
      )
    : undefined;
  const activeHistoryQuota = activeHistoryView?.usageGroups
    .flatMap((group) => group.quotas)
    .find((quota) => quota.id === activeHistoryMetricId);

  const openHistory = (
    instanceId: ProviderInstanceId,
    focusKey: string,
    requestedMetricId?: string,
  ) => {
    const snapshot = state.instances.find((instance) => instance.id === instanceId)?.snapshot;
    const providerMetrics = snapshot ? quotaMetrics(snapshot) : [];
    const explicitMetricId = providerMetrics.some(
      (metric) => metric.id === requestedMetricId,
    )
      ? requestedMetricId
      : undefined;
    const savedMetricId = historySelection.metrics[instanceId];
    const validSavedMetricId = providerMetrics.some(
      (metric) => metric.id === savedMetricId,
    )
      ? savedMetricId
      : undefined;
    const metricId =
      explicitMetricId ?? validSavedMetricId ?? providerMetrics[0]?.id;
    setHistorySelection((current) => ({
      instanceId,
      metrics: {
        ...current.metrics,
        ...(metricId ? { [instanceId]: metricId } : {}),
      },
    }));
    pushScreen({ name: "history", instanceId, metricId }, focusKey);
  };

  return (
    <main className="cockpit" ref={cockpitRef}>
      {view.name === "overview" && !isFirstRun ? (
        <AppHeader
          mode={mode}
          isRefreshing={isRefreshing}
          settingsOpen={false}
          providerCount={connectedInstances.length}
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
        view.providerKind === "newapi" ? (
          <NewApiConnectView
            mode={view.mode}
            initialBaseUrl={
              view.instanceId
                ? state.instances.find((instance) => instance.id === view.instanceId)
                    ?.baseUrl
                : undefined
            }
            initialUserLabel={
              view.instanceId
                ? state.instances.find((instance) => instance.id === view.instanceId)
                    ?.userLabel
                : undefined
            }
            instanceLabel={
              view.instanceId
                ? labelForInstance(view.instanceId)
                : undefined
            }
            backLabel={apiKeyBackLabel}
            onBack={popScreen}
            onSubmit={async (baseUrl, apiKey, userLabel) => {
              const result = await onSubmitApiKey({
                providerKind: view.providerKind,
                apiKey,
                baseUrl,
                ...(view.instanceId ? { instanceId: view.instanceId } : {}),
                ...(
                  view.mode === "replace" || userLabel
                    ? { userLabel }
                    : {}
                ),
              });
              if (result === "connected") goHome();
              return result;
            }}
          />
        ) : (
          <ApiKeyConnectView
            mode={view.mode}
            backLabel={apiKeyBackLabel}
            onBack={popScreen}
            onOpenSetup={() => onOpenApiKeySetup(view.providerKind)}
            onSubmit={async (apiKey) => {
              const result = await onSubmitApiKey({
                providerKind: view.providerKind,
                apiKey,
                ...(view.instanceId ? { instanceId: view.instanceId } : {}),
              });
              if (result === "connected") goHome();
              return result;
            }}
          />
        )
      ) : view.name === "settings" ? (
        <SettingsView
          autoRefresh={state.preferences.autoRefresh}
          autoRefreshPending={autoRefreshPending}
          instances={state.instances}
          now={now}
          confirmDelete={confirmDelete}
          addProviderButtonRef={settingsAddProviderButton}
          closeLabel={
            previousScreen?.name === "provider"
              ? labelForInstance(previousScreen.instanceId)
              : "Overview"
          }
          onClose={popScreen}
          onAddProvider={() =>
            pushScreen({ name: "add-provider" }, "settings-add-provider")
          }
          onAutoRefreshChange={onAutoRefreshChange}
          onDisconnectInstance={onDisconnectInstance}
          onRenameInstance={onRenameInstance}
          onReplaceApiKey={(providerKind, instanceId) =>
            openApiKeyConnect(providerKind, "replace", instanceId)
          }
          onDeleteLocalData={onDeleteLocalData}
          onConfirmDeleteChange={setConfirmDelete}
        />
      ) : view.name === "add-provider" ? (
        <AddProviderView
          providers={availableProviders}
          origin={previousScreen?.name === "settings" ? "settings" : "overview"}
          onBack={popScreen}
          onConnectProvider={connectProvider}
        />
      ) : view.name === "provider" ? (
        <ProviderDetailView
          provider={detailProvider}
          operation={providerOperations[view.instanceId]}
          onBack={popScreen}
          onHome={goHome}
          onRefreshInstance={onRefreshInstance}
          onOpenHistory={(instanceId, metricId, focusKey) =>
            openHistory(
              instanceId,
              focusKey ?? `provider-history-${instanceId}`,
              metricId ?? (detailRecord?.snapshot ? quotaMetrics(detailRecord.snapshot)[0]?.id : undefined),
            )
          }
          onOpenSettings={() =>
            pushScreen(
              { name: "settings" },
              `provider-settings-${view.instanceId}`,
            )
          }
        />
      ) : view.name === "history" ? (
        <HistoryView
          instances={state.instances}
          instanceId={activeHistoryInstanceId ?? view.instanceId}
          metricId={activeHistoryMetricId}
          metricIdsByInstance={historySelection.metrics}
          currentQuota={activeHistoryQuota}
          mode={mode}
          now={now}
          backLabel={historyBackLabel}
          onBack={popScreen}
          onDisplayModeChange={onDisplayModeChange}
          onSelectionChange={(instanceId, metricId) =>
            setHistorySelection((current) => ({
              instanceId,
              metrics: { ...current.metrics, [instanceId]: metricId },
            }))
          }
        />
      ) : isFirstRun ? (
        <FirstRunView
          providers={availableProviders}
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
          onRefreshInstance={onRefreshInstance}
          onOpenProvider={(instanceId) =>
            pushScreen(
              { name: "provider", instanceId },
              `overview-provider-${instanceId}`,
            )
          }
          onOpenHistory={(instanceId, metricId) =>
            openHistory(
              instanceId,
              `provider-history-${instanceId}-${metricId}`,
              metricId,
            )
          }
          onReplaceApiKey={(providerKind, instanceId) =>
            openApiKeyConnect(providerKind, "replace", instanceId)
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
