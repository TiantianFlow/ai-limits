import React, { useEffect, useState } from "react";

import type {
  DisplayMode,
  ProviderId,
  ProviderRecord,
} from "../../../domain/model";
import { providerNames } from "../../../providers/catalog";
import { quotaMetrics } from "../metrics";
import { HistoryChart } from "../components/HistoryChart";
import { PageHeader } from "../components/PageHeader";
import type { QuotaView } from "../components/ProviderCard";
import { QuotaBars } from "../components/QuotaBars";

export interface HistoryViewProps {
  providers: ProviderRecord[];
  providerId: ProviderId;
  metricId?: string;
  metricIdsByProvider: Partial<Record<ProviderId, string>>;
  currentQuota?: QuotaView;
  mode: DisplayMode;
  now: number;
  backLabel: string;
  onBack: () => void;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onSelectionChange: (providerId: ProviderId, metricId: string) => void;
}

const RANGE_OPTIONS = [
  { hours: 48, short: "48H", label: "48 hours" },
  { hours: 7 * 24, short: "7D", label: "7 days" },
  { hours: 30 * 24, short: "30D", label: "30 days" },
] as const;

export function HistoryView({
  providers,
  providerId,
  metricId,
  metricIdsByProvider,
  currentQuota,
  mode,
  now,
  backLabel,
  onBack,
  onDisplayModeChange,
  onSelectionChange,
}: HistoryViewProps) {
  const eligibleProviders = providers.filter(
    (provider) =>
      provider.access === "granted" &&
      provider.snapshot !== undefined &&
      quotaMetrics(provider.snapshot).length > 0,
  );
  const provider = eligibleProviders.find(
    (candidate) => candidate.providerId === providerId,
  );
  const metrics = provider?.snapshot ? quotaMetrics(provider.snapshot) : [];
  const selectedMetric =
    metrics.find((metric) => metric.id === metricId) ?? metrics[0];
  const [rangeHours, setRangeHours] = useState<number>(48);

  useEffect(() => {
    setRangeHours(48);
  }, [providerId, selectedMetric?.id]);

  if (!provider || !selectedMetric) {
    return (
      <section className="screen" aria-label="History unavailable">
        <PageHeader
          title="History unavailable"
          subtitle="No current quota metric is available"
          backLabel={backLabel}
          onBack={onBack}
        />
      </section>
    );
  }

  const providerName = providerNames[provider.providerId];

  return (
    <section className="screen" aria-label={`${providerName} history`}>
      <PageHeader
        title={`${providerName} history`}
        subtitle="Local quota observations · 30-day retention on this device"
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="history-screen screen-body">
        {eligibleProviders.length > 1 ? (
          <label className="compact-select">
            <span>Provider</span>
            <select
              aria-label="History provider"
              value={provider.providerId}
              onChange={(event) => {
                const nextProvider = eligibleProviders.find(
                  (candidate) => candidate.providerId === event.currentTarget.value,
                );
                const nextMetrics = nextProvider?.snapshot
                  ? quotaMetrics(nextProvider.snapshot)
                  : [];
                const savedMetricId = nextProvider
                  ? metricIdsByProvider[nextProvider.providerId]
                  : undefined;
                const nextMetric =
                  nextMetrics.find((metric) => metric.id === savedMetricId) ??
                  nextMetrics[0];
                if (nextProvider && nextMetric) {
                  onSelectionChange(nextProvider.providerId, nextMetric.id);
                }
              }}
            >
              {eligibleProviders.map((candidate) => (
                <option key={candidate.providerId} value={candidate.providerId}>
                  {providerNames[candidate.providerId]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="compact-select">
          <span>Metric</span>
          <select
            aria-label="Quota metric"
            value={selectedMetric.id}
            onChange={(event) =>
              onSelectionChange(provider.providerId, event.currentTarget.value)
            }
          >
            {metrics.map((metric) => (
              <option key={metric.id} value={metric.id}>
                {metric.label}
              </option>
            ))}
          </select>
        </label>

        <div className="history-controls">
          <div
            className="compact-choice"
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
                <span>{option === "used" ? "Used" : "Left"}</span>
              </button>
            ))}
          </div>
          <div
            className="compact-choice"
            role="radiogroup"
            aria-label="History range"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.hours}
                role="radio"
                type="button"
                aria-label={option.label}
                aria-checked={rangeHours === option.hours}
                onClick={() => setRangeHours(option.hours)}
              >
                <span>{option.short}</span>
              </button>
            ))}
          </div>
        </div>

        <section className="history-surface" aria-label="Usage history chart">
          <div className="history-surface__heading">
            <h2>{selectedMetric.label}</h2>
            <span>{selectedMetric.scope} quota</span>
          </div>
          <HistoryChart
            providerName={providerName}
            mode={mode}
            metrics={[selectedMetric]}
            history={provider.history}
            now={now}
            rangeHours={rangeHours}
          />
        </section>

        {currentQuota?.id === selectedMetric.id ? (
          <section className="current-cycle-surface" aria-label="Current cycle">
            <h2>Current cycle</h2>
            <QuotaBars {...currentQuota} mode={mode} />
          </section>
        ) : null}

        <p className="illustrative-note">
          Only successful, normalized quota observations are plotted. The line
          breaks at resets and periods without an observation rather than
          implying zero usage. The newest 48 hours stay at collection resolution;
          older retained history is compacted hourly and kept for up to 30 days
          on this device. Counter and balance observations are stored but are not
          available as graph series.
        </p>
      </div>
    </section>
  );
}
