import React, { useEffect, useState } from "react";

import { l10n, type MessageKey } from "../../../i18n/index";
import {
  localizeDisplayMode,
  localizeMetricLabel,
  localizeMetricScope,
  localizeProviderName,
} from "../../../i18n/presentation";
import {
  meterPolicy,
  type DisplayMode,
  type ProviderInstanceId,
  type ProviderInstanceView,
} from "../../../domain/public-protocol";
import { instanceLabels } from "../instance-label";
import { quotaMetrics } from "../metrics";
import { HistoryChart } from "../components/HistoryChart";
import { PageHeader } from "../components/PageHeader";
import { WindowSelect } from "../components/WindowSelect";
import type { QuotaView } from "../components/ProviderCard";
import { QuotaBars } from "../components/QuotaBars";

export interface HistoryViewProps {
  instances: ProviderInstanceView[];
  instanceId: ProviderInstanceId;
  metricId?: string;
  currentQuota?: QuotaView;
  mode: DisplayMode;
  now: number;
  backLabel: string;
  onBack: () => void;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onSelectionChange: (metricId: string) => void;
}

const RANGE_OPTIONS = [
  { hours: 48, shortKey: "history.range48hShort", labelKey: "history.range48h" },
  { hours: 7 * 24, shortKey: "history.range7dShort", labelKey: "history.range7d" },
  { hours: 30 * 24, shortKey: "history.range30dShort", labelKey: "history.range30d" },
] as const;

const RANGE_STORAGE_KEY = "ai-limits.historyRangeHours";

function readStoredRange(): number | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const stored = Number(localStorage.getItem(RANGE_STORAGE_KEY));
  return RANGE_OPTIONS.some((option) => option.hours === stored) ? stored : undefined;
}

function readingsInRange(
  history: { observedAt: number; metrics: { type: string; metricId: string }[] }[],
  metricId: string,
  now: number,
  hours: number,
): number {
  const start = now - hours * 60 * 60 * 1_000;
  return history.filter((observation) =>
    observation.observedAt >= start &&
    observation.observedAt <= now &&
    observation.metrics.some((sample) => sample.type === "quota" && sample.metricId === metricId),
  ).length;
}

function defaultRangeHours(
  providerKind: ProviderInstanceView["providerKind"] | undefined,
  metricId: string,
  durationMs: number | undefined,
): number {
  const windowMs = meterPolicy(providerKind, metricId)?.windowMs ?? durationMs ?? 0;
  const dayMs = 24 * 60 * 60 * 1_000;
  const shortWindow = windowMs > 0 && !(windowMs > dayMs);
  return shortWindow ? 7 * 24 : 30 * 24;
}

export function HistoryView({
  instances,
  instanceId,
  metricId,
  currentQuota,
  mode,
  now,
  backLabel,
  onBack,
  onDisplayModeChange,
  onSelectionChange,
}: HistoryViewProps) {
  const eligibleInstances = instances.filter(
    (instance) =>
      instance.access === "granted" &&
      instance.snapshot !== undefined &&
      quotaMetrics(instance.snapshot).length > 0,
  );
  const labelsByInstance = instanceLabels(instances);
  const instance = eligibleInstances.find(
    (candidate) => candidate.id === instanceId,
  );
  const metrics = instance?.snapshot ? quotaMetrics(instance.snapshot) : [];
  const selectedMetric =
    metrics.find((metric) => metric.id === metricId) ?? metrics[0];
  const providerKind = instance?.providerKind;
  const openingMetric = metrics.find((item) => item.id === metricId) ?? metrics[0];
  // A picked range is the user's, so it survives meter and provider changes
  // and a panel reload. The v15 default applies only before any pick.
  const [rangeHours, setRangeHours] = useState<number>(() =>
    readStoredRange() ?? defaultRangeHours(providerKind, openingMetric?.id ?? "", openingMetric?.cycle?.durationMs),
  );
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RANGE_STORAGE_KEY, String(rangeHours));
  }, [rangeHours]);

  if (!instance || !selectedMetric) {
    return (
      <section className="screen" aria-label={l10n.t("history.unavailableScreen")}>
        <PageHeader
          title={l10n.t("history.unavailableTitle")}
          subtitle={l10n.t("history.unavailableSubtitle")}
          backLabel={backLabel}
          onBack={onBack}
        />
      </section>
    );
  }

  const providerName = localizeProviderName(instance.providerKind);
  const label = labelsByInstance.get(instance.id)!;
  const selectedLabel = localizeMetricLabel(instance.providerKind, selectedMetric);
  const localizedMetrics = metrics.map((metric) => ({
    ...metric,
    label: localizeMetricLabel(instance.providerKind, metric),
  }));

  return (
    <section className="screen" aria-label={l10n.t("history.titleNamed", { label })}>
      <PageHeader
        title={l10n.t("history.titleNamed", { label })}
        subtitle={l10n.t("history.subtitle", { provider: providerName })}
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="history-screen screen-body">
        <WindowSelect
          options={localizedMetrics.map((metric) => ({
            id: metric.id,
            label: metric.label,
          }))}
          selectedId={selectedMetric.id}
          onSelectionChange={onSelectionChange}
        />

        <div className="history-controls">
          <div
            className="compact-choice"
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
                <span>{localizeDisplayMode(option)}</span>
              </button>
            ))}
          </div>
          <div
            className="compact-choice"
            role="radiogroup"
            aria-label={l10n.t("history.range")}
          >
            {RANGE_OPTIONS.map((option) => {
              const count = readingsInRange(instance.history, selectedMetric.id, now, option.hours);
              const hasReadings = count > 0;
              const underFive = count < 5;
              const sparse = hasReadings && underFive;
              return (
                <button
                  key={option.hours}
                  role="radio"
                  type="button"
                  aria-label={sparse
                    ? l10n.t("history.rangeSparse", {
                        range: l10n.t(option.labelKey as MessageKey),
                        count,
                      })
                    : l10n.t(option.labelKey as MessageKey)}
                  aria-checked={rangeHours === option.hours}
                  onClick={() => setRangeHours(option.hours)}
                >
                  <span>
                    {sparse
                      ? l10n.t("history.rangeCount", {
                          range: l10n.t(option.shortKey as MessageKey),
                          count,
                        })
                      : l10n.t(option.shortKey as MessageKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <section className="history-surface" aria-label={l10n.t("history.chart")}>
          <div className="history-surface__heading">
            <h2>{selectedLabel}</h2>
            <span>
              {l10n.t("history.scopeQuota", {
                scope: localizeMetricScope(selectedMetric.scope),
              })}
            </span>
          </div>
          <HistoryChart
            providerName={label}
            providerKind={instance.providerKind}
            mode={mode}
            metrics={localizedMetrics.filter(
              (metric) => metric.id === selectedMetric.id,
            )}
            history={instance.history}
            now={now}
            rangeHours={rangeHours}
          />
        </section>

        {currentQuota?.id === selectedMetric.id ? (
          <section
            className="current-cycle-surface"
            aria-label={l10n.t("history.currentCycle")}
          >
            <h2>{l10n.t("history.currentCycle")}</h2>
            <QuotaBars {...currentQuota} mode={mode} />
          </section>
        ) : null}

        <p className="illustrative-note">{l10n.t("history.note")}</p>
      </div>
    </section>
  );
}
