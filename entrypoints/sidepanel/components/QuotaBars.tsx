import React from "react";

import { l10n } from "../../../i18n/index";
import { formatPercent as formatPercentNumber } from "../../../i18n/format";
import { localizeDisplayModeCompact } from "../../../i18n/presentation";
import type { DisplayMode, PaceKind } from "../../../domain/public-protocol";
import { PaceSignal } from "./PaceSignal";

export interface QuotaSegmentView {
  id: string;
  label: string;
  percent: number;
}

export interface QuotaBarsProps {
  id: string;
  label: string;
  mode: DisplayMode;
  quotaPercent: number;
  usedPercent: number;
  valueLabel?: string;
  timePercent?: number;
  timeLabel?: string;
  resetAt?: number;
  resetLabel?: string;
  paceKind?: PaceKind;
  paceLabel: string;
  segments?: QuotaSegmentView[];
  onOpenHistory?: (metricId: string) => void;
  historyLabel?: string;
  historyFocusKey?: string;
}

function formatPercent(value: number): string {
  return formatPercentNumber(value);
}

function quotaTone(usedPercent: number): "accent" | "warning" | "critical" {
  if (usedPercent >= 92) {
    return "critical";
  }

  return usedPercent >= 75 ? "warning" : "accent";
}

export function QuotaBars({
  id,
  label,
  mode,
  quotaPercent,
  usedPercent,
  valueLabel,
  timePercent,
  timeLabel,
  resetAt,
  resetLabel,
  paceKind,
  paceLabel,
  segments = [],
  onOpenHistory,
  historyLabel,
  historyFocusKey,
}: QuotaBarsProps) {
  const stacked = mode === "used" && segments.length > 0;
  const tone = quotaTone(usedPercent);

  return (
    <section className="quota-bars" role="group" aria-label={label}>
      <div className="quota-bars__heading">
        {onOpenHistory ? (
          <button
            className="quota-bars__history"
            type="button"
            aria-label={historyLabel ?? l10n.t("quota.historyFor", { label })}
            data-focus-key={historyFocusKey}
            onClick={() => onOpenHistory(id)}
          >
            {label}
          </button>
        ) : (
          <h3>{label}</h3>
        )}
        <p className="quota-bars__value">
          {valueLabel ? <span>{valueLabel}</span> : null}
          <strong>
            {mode === "used"
              ? l10n.t("quota.percentUsed", {
                  percent: formatPercent(quotaPercent),
                })
              : l10n.t("quota.percentLeft", {
                  percent: formatPercent(quotaPercent),
                })}
          </strong>
        </p>
      </div>

      <div
        className="meter meter--quota"
        role="meter"
        aria-label={l10n.t("quota.meterQuota", {
          label,
          mode: localizeDisplayModeCompact(mode),
        })}
        aria-valuenow={quotaPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {stacked ? (
          segments.map((segment, index) => (
            <span
              key={segment.id}
              className={`meter__segment meter__segment--${(index % 3) + 1}`}
              style={{ width: `${segment.percent}%` }}
            />
          ))
        ) : (
          <span
            className={`meter__fill--${tone}`}
            style={{ width: `${quotaPercent}%` }}
          />
        )}
      </div>

      {timePercent !== undefined ? (
        <div
          className="meter meter--time"
          role="meter"
          aria-label={
            mode === "used"
              ? l10n.t("quota.meterTimeElapsed", { label })
              : l10n.t("quota.meterTimeRemaining", { label })
          }
          aria-valuenow={timePercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${timePercent}%` }} />
        </div>
      ) : null}

      <div className="quota-bars__meta">
        <div className="quota-bars__meta-primary">
          <span className="quota-bars__timing">
            {timeLabel ? <span>{timeLabel}</span> : <span>{l10n.t("quota.noResetTiming")}</span>}
          </span>
          <PaceSignal kind={paceKind} label={paceLabel} />
        </div>
        {resetAt !== undefined && resetLabel ? (
          <time
            className="quota-bars__reset"
            dateTime={new Date(resetAt).toISOString()}
          >
            {resetLabel}
          </time>
        ) : null}
      </div>

      {segments.length > 0 ? (
        <ul className="quota-bars__segments">
          {segments.map((segment, index) => (
            <li key={segment.id}>
              <span
                aria-hidden="true"
                className={`segment-key segment-key--${(index % 3) + 1}`}
              />
              {l10n.t("quota.segmentPercent", {
                label: segment.label,
                percent: formatPercent(segment.percent),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
