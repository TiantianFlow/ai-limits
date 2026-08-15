import React, { useEffect, useState } from "react";

import type {
  DisplayMode,
  ProviderInstanceId,
  ProviderInstanceView,
} from "../../../domain/public-protocol";
import { providerNames } from "../../../domain/public-protocol";
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
  { hours: 48, short: "48H", label: "48 hours" },
  { hours: 7 * 24, short: "7D", label: "7 days" },
  { hours: 30 * 24, short: "30D", label: "30 days" },
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

  const providerName = providerNames[instance.providerKind];
  const label = labelsByInstance.get(instance.id)!;

  return (
    <section className="screen" aria-label={`${label} history`}>
      <PageHeader
        title={`${label} history`}
        subtitle={`${providerName} · Local quota observations · 30-day retention on this device`}
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="history-screen screen-body">
        <WindowSelect
          options={metrics.map((metric) => ({
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
            providerName={label}
            mode={mode}
            metrics={[selectedMetric]}
            history={instance.history}
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
