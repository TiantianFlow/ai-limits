import React, { useEffect, useRef, useState } from "react";

import { l10n, type AnnouncementTone, type SupportedLocale } from "../../i18n/index";
import { formatAmount, formatDateTime, formatNumber } from "../../i18n/format";
import {
  localizeBalanceValue,
  localizeConnectionDisclosure,
  localizeCounterValue,
  localizeFailure,
  localizeManualRefreshDisclosure,
  localizeMetricLabel,
  localizePlanLabel,
  localizeProviderName,
  localizeQuotaValue,
  localizeRecoveryGuidance,
  localizeSegmentLabel,
} from "../../i18n/presentation";
import {
  canCreateProviderInstance,
  displayRatio,
  elapsedRatio,
  paceStatus,
  providerAvailability,
  providerKinds,
  providerPresentation,
  shouldDisplayBalance,
  type ApiKeyProviderKind,
  type AppViewState,
  type BalanceMetric,
  type CounterMetric,
  type DisplayMode,
  type PaceStatus,
  type ProviderInstanceId,
  type ProviderInstanceView,
  type ProviderKind,
  type ProviderOperation,
  type QuotaMetric,
} from "../../domain/public-protocol";
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
import { instanceLabels } from "./instance-label";

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
  refreshAnnouncementTone?: AnnouncementTone;
  refreshAnnouncementId?: number;
  autoRefreshPending?: boolean;
  localeOverride?: SupportedLocale;
  providerOperations?: Partial<Record<ProviderInstanceId, ProviderOperation>>;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onRefresh: () => void;
  onConnectProvider: (providerKind: ProviderKind) => void;
  onOpenApiKeySetup?: (providerKind: ApiKeyProviderKind) => void;
  onSubmitApiKey?: (submission: ApiKeySubmission) => Promise<ApiKeyConnectAttemptResult>;
  onRefreshInstance?: (instanceId: ProviderInstanceId) => void;
  onAutoRefreshChange?: (enabled: boolean) => void;
  onLocaleOverrideChange?: (locale: SupportedLocale | undefined) => void;
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
  const total = Math.round(duration / unitMs);
  const amount = Math.round((duration * ratio) / unitMs);
  const family =
    duration >= day
      ? noun === "elapsed"
        ? "quota.elapsedDays"
        : "quota.remainingDays"
      : noun === "elapsed"
        ? "quota.elapsedHours"
        : "quota.remainingHours";

  return l10n.count(family, total, {
    amount: formatNumber(amount),
    total: formatNumber(total),
  });
}

function formatReset(resetsAt: number): string {
  return l10n.t("quota.resets", { when: formatDateTime(resetsAt) });
}

function formatPace(status: PaceStatus | undefined): string {
  if (!status) {
    return l10n.t("pace.unavailable");
  }

  if (status.kind === "on-pace") {
    return l10n.t("pace.onPace");
  }

  const points = formatNumber(Math.abs(status.deltaPoints));
  return status.kind === "ahead"
    ? l10n.t("pace.ahead", { points })
    : l10n.t("pace.behind", { points });
}

function quotaView(
  providerKind: ProviderKind,
  metric: QuotaMetric,
  mode: DisplayMode,
  now: number,
): QuotaView {
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
      : localizeQuotaValue(shownCount, metric.limit);

  return {
    id: metric.id,
    label: localizeMetricLabel(providerKind, metric),
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
      label: localizeSegmentLabel(providerKind, segment),
      percent: percent(segment.usedRatio),
    })),
  };
}

function counterView(
  providerKind: ProviderKind,
  metric: CounterMetric,
): MetricValueView {
  const amount = formatAmount(metric.value, metric.unit);
  const limit =
    metric.limit === undefined
      ? undefined
      : formatAmount(metric.limit, metric.unit);
  const value = limit
    ? l10n.t("quota.withLimit", { value: amount, limit })
    : amount;
  return {
    id: metric.id,
    label: localizeMetricLabel(providerKind, metric),
    value: localizeCounterValue(value, metric.semantic),
  };
}

function balanceView(
  providerKind: ProviderKind,
  metric: BalanceMetric,
): MetricValueView {
  return {
    id: metric.id,
    label: localizeMetricLabel(providerKind, metric),
    value: localizeBalanceValue(formatAmount(metric.value, metric.unit)),
  };
}

function formatFreshness(fetchedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));

  if (minutes < 1) {
    return l10n.t("freshness.updatedJustNow");
  }

  return l10n.t("freshness.updatedAge", {
    age: l10n.count("freshness.minutesAgo", minutes),
  });
}

function freshnessAge(fetchedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
  if (minutes < 1) {
    return l10n.t("freshness.justNow");
  }
  return l10n.count("freshness.minutesAgo", minutes);
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
    ? l10n.t("freshness.unavailable")
    : freshnessAge(latest, now);
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
      return l10n.t("refresh.retryLater");
    }

    if (
      provider.providerKind === "kimi" &&
      provider.lastAttempt?.trigger === "scheduled"
    ) {
      return stale || !provider.snapshot
        ? l10n.t("refresh.kimiScheduledNeedsTab")
        : undefined;
    }

    return provider.providerKind === "kimi"
      ? l10n.t("refresh.kimiNeedsSession")
      : l10n.t("refresh.waitingForSession");
  }

  if (
    outcome.category === "temporary_error" &&
    provider.lastAttempt?.trigger === "scheduled" &&
    provider.snapshot &&
    !stale
  ) {
    return undefined;
  }

  if (outcome.guidance === "retry_session") {
    return localizeRecoveryGuidance(provider.providerKind);
  }

  return localizeFailure(outcome.category);
}

export function providerView(
  provider: ProviderInstanceView,
  mode: DisplayMode,
  now: number,
  resolvedInstanceLabel = instanceLabels([provider]).get(provider.id)!,
  _recoveryGuidance?: string,
): ProviderCardProps {
  const snapshot = provider.snapshot;
  const stale = snapshot ? now - snapshot.fetchedAt > STALE_AFTER_MS : false;
  const hiddenQuotaIds =
    provider.providerKind === "grok"
      ? new Set(
          snapshot?.usageGroups
            ?.filter((group) => group.id === "rate-limits")
            .flatMap((group) => group.metricIds) ?? [],
        )
      : undefined;
  const quotas = snapshot?.metrics
    ? quotaMetrics(snapshot)
        .filter((metric) => !hiddenQuotaIds?.has(metric.id))
        .map((metric) => quotaView(provider.providerKind, metric, mode, now))
    : [];
  const values = snapshot?.metrics
    ? [
        ...counterMetrics(snapshot).map((metric) =>
          counterView(provider.providerKind, metric),
        ),
        ...balanceMetrics(snapshot)
          .filter((metric) =>
            shouldDisplayBalance(provider.providerKind, metric.value),
          )
          .map((metric) => balanceView(provider.providerKind, metric)),
      ]
    : [];
  const plan = localizePlanLabel(provider.providerKind, snapshot?.planLabel);

  return {
    instanceId: provider.id,
    instanceLabel: resolvedInstanceLabel,
    providerId: provider.providerKind,
    name: localizeProviderName(provider.providerKind),
    plan,
    mode,
    values,
    usageGroups:
      snapshot === undefined
        ? []
        : usageGroupViews(provider.providerKind, snapshot.usageGroups, quotas, values),
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
        ? localizeConnectionDisclosure(provider.providerKind)
        : l10n.t("card.noUsageStored", {
            provider: localizeProviderName(provider.providerKind),
          }),
    extraDisclosure:
      provider.access === "required"
        ? localizeManualRefreshDisclosure(provider.providerKind)
        : undefined,
    detailTables: snapshot?.detailTables,
    now,
  };
}

export function Cockpit({
  state,
  now,
  isRefreshing = false,
  refreshAnnouncement = "",
  refreshAnnouncementTone = "success",
  refreshAnnouncementId = 0,
  autoRefreshPending = false,
  localeOverride,
  providerOperations = {},
  onDisplayModeChange,
  onRefresh,
  onConnectProvider,
  onOpenApiKeySetup = () => undefined,
  onSubmitApiKey = async () => "temporary_error",
  onRefreshInstance = () => undefined,
  onAutoRefreshChange = () => undefined,
  onLocaleOverrideChange = () => undefined,
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
  const [historySelection, setHistorySelection] = useState<
    Partial<Record<ProviderInstanceId, string>>
  >({});
  const [dismissedRefreshAnnouncementId, setDismissedRefreshAnnouncementId] =
    useState<number>();
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
    if (providerPresentation(providerKind).apiKeySetupUrl) {
      onOpenApiKeySetup(providerKind);
    }
  };

  const connectProvider = (providerKind: ProviderKind) => {
    if (providerAvailability(state, providerKind).credentialKind === "api-key") {
      openApiKeyConnect(providerKind as ApiKeyProviderKind, "connect");
      return;
    }

    onConnectProvider(providerKind);
  };

  const connectedInstances = state.instances.filter(
    (instance) => instance.access === "granted",
  );
  const labelsByInstance = instanceLabels(state.instances);
  const availableProviderKinds = providerKinds.filter((providerKind) =>
    canCreateProviderInstance(state, providerKind),
  );
  const availableProviders = availableProviderKinds.map((providerKind) => ({
    providerKind,
    credentialKind: providerAvailability(state, providerKind).credentialKind,
    isReconnect: state.instances.some(
      (instance) =>
        instance.providerKind === providerKind && instance.access === "required",
    ),
    operation:
      providerAvailability(state, providerKind).cardinality === "single"
        ? providerOperations[`${providerKind}:default`]
        : undefined,
  }));
  const overviewProviders = connectedInstances.map((instance) => {
    const card = providerView(
      instance,
      mode,
      now,
      labelsByInstance.get(instance.id)!,
      providerAvailability(state, instance.providerKind).recoveryGuidance,
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
        providerAvailability(state, instance.providerKind).credentialKind === "api-key" &&
        (failureCategory === "credential_invalid" ||
          failureCategory === "credential_scope_required"),
    };
  });
  const isFirstRun = view.name === "overview" && connectedInstances.length === 0;
  const previousScreen = navigation.backStack.at(-1);
  const labelForInstance = (instanceId: ProviderInstanceId): string => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    return instance
      ? labelsByInstance.get(instance.id)!
      : l10n.t("common.provider");
  };
  const historyBackLabel =
    previousScreen?.name === "provider"
      ? labelForInstance(previousScreen.instanceId)
      : previousScreen?.name === "overview"
        ? l10n.t("common.overview")
        : previousScreen?.name === "settings"
          ? l10n.t("common.settings")
          : l10n.t("common.back");
  const apiKeyBackLabel =
    previousScreen?.name === "provider"
      ? labelForInstance(previousScreen.instanceId)
      : previousScreen?.name === "add-provider"
        ? l10n.t("common.addProvider")
      : previousScreen?.name === "settings"
          ? l10n.t("common.settings")
          : previousScreen?.name === "overview" &&
              connectedInstances.length === 0 &&
              view.name === "api-key-connect" &&
              providerAvailability(state, view.providerKind).configKind ===
                "dynamic-origin"
            ? l10n.t("navigation.connectYourProviders")
          : l10n.t("common.overview");
  const detailRecord =
    view.name === "provider"
      ? state.instances.find(
          (instance) =>
            instance.id === view.instanceId &&
            instance.access === "granted",
        )
      : undefined;
  const detailProvider = detailRecord
    ? providerView(
        detailRecord,
        mode,
        now,
        labelsByInstance.get(detailRecord.id)!,
        providerAvailability(state, detailRecord.providerKind).recoveryGuidance,
      )
    : undefined;
  const activeHistoryInstanceId =
    view.name === "history" ? view.instanceId : undefined;
  const activeHistoryMetricId = activeHistoryInstanceId
    ? historySelection[activeHistoryInstanceId] ??
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
        labelsByInstance.get(activeHistoryRecord.id)!,
        providerAvailability(state, activeHistoryRecord.providerKind).recoveryGuidance,
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
    const savedMetricId = historySelection[instanceId];
    const validSavedMetricId = providerMetrics.some(
      (metric) => metric.id === savedMetricId,
    )
      ? savedMetricId
      : undefined;
    const metricId =
      explicitMetricId ?? validSavedMetricId ?? providerMetrics[0]?.id;
    setHistorySelection((current) => ({
      ...current,
      ...(metricId ? { [instanceId]: metricId } : {}),
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
          message={
            dismissedRefreshAnnouncementId === refreshAnnouncementId
              ? ""
              : refreshAnnouncement
          }
          tone={refreshAnnouncementTone}
          onDismiss={() =>
            setDismissedRefreshAnnouncementId(refreshAnnouncementId)
          }
        />
      ) : null}

      {view.name === "api-key-connect" ? (
        providerAvailability(state, view.providerKind).configKind ===
        "dynamic-origin" ? (
          <NewApiConnectView
            providerKind={view.providerKind}
            guideKind={
              providerPresentation(view.providerKind).apiKeyGuide === "newapi"
                ? "newapi"
                : undefined
            }
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
            providerKind={view.providerKind}
            guideKind={
              providerPresentation(view.providerKind).apiKeyGuide === "elevenlabs"
                ? "elevenlabs"
                : undefined
            }
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
          localeOverride={localeOverride}
          instances={state.instances}
          providers={state.providers}
          now={now}
          confirmDelete={confirmDelete}
          addProviderButtonRef={settingsAddProviderButton}
          closeLabel={
            previousScreen?.name === "provider"
              ? labelForInstance(previousScreen.instanceId)
              : l10n.t("common.overview")
          }
          onClose={popScreen}
          onAddProvider={() =>
            pushScreen({ name: "add-provider" }, "settings-add-provider")
          }
          onAutoRefreshChange={onAutoRefreshChange}
          onLocaleOverrideChange={onLocaleOverrideChange}
          onReconnectProvider={connectProvider}
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
          currentQuota={activeHistoryQuota}
          mode={mode}
          now={now}
          backLabel={historyBackLabel}
          onBack={popScreen}
          onDisplayModeChange={onDisplayModeChange}
          onSelectionChange={(metricId) =>
            setHistorySelection((current) => ({
              ...current,
              [view.instanceId]: metricId,
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
          message={
            dismissedRefreshAnnouncementId === refreshAnnouncementId
              ? ""
              : refreshAnnouncement
          }
        />
      ) : null}
    </main>
  );
}
