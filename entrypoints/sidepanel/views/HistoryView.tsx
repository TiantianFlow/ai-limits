import React, { useEffect, useState } from "react";

import { l10n, type MessageKey } from "../../../i18n/index";
import {
  localizeDisplayMode,
  localizeMetricLabel,
  localizeMetricScope,
  localizeProviderName,
} from "../../../i18n/presentation";
import type {
  DisplayMode,
  ProviderInstanceId,
  ProviderInstanceView,
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
  const [rangeHours, setRangeHours] = useState<number>(48);

  useEffect(() => {
    setRangeHours(48);
  }, [instanceId]);

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
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.hours}
                role="radio"
                type="button"
                aria-label={l10n.t(option.labelKey as MessageKey)}
                aria-checked={rangeHours === option.hours}
                onClick={() => setRangeHours(option.hours)}
              >
                <span>{l10n.t(option.shortKey as MessageKey)}</span>
              </button>
            ))}
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
