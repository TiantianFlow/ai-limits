import React, { useEffect, useId, useState } from "react";

import { l10n } from "../../../i18n/index";
import { formatDateTime } from "../../../i18n/format";
import { localizeDisplayModeCompact } from "../../../i18n/presentation";
import {
  quotaHistorySeries,
  type MetricHistoryPoint,
  type DisplayMode,
  type QuotaHistorySeries,
  type QuotaMetric,
  type UsageHistoryObservation,
} from "../../../domain/public-protocol";

export interface HistoryChartProps {
  providerName: string;
  mode: DisplayMode;
  metrics: QuotaMetric[];
  history: UsageHistoryObservation[];
  now: number;
  rangeHours?: number;
}

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 112;
const PLOT_LEFT = 28;
const PLOT_RIGHT = 312;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 88;

function timePosition(
  observedAt: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  const duration = Math.max(1, rangeEnd - rangeStart);
  return (
    PLOT_LEFT +
    ((observedAt - rangeStart) / duration) * (PLOT_RIGHT - PLOT_LEFT)
  );
}

function ratioPosition(
  observedAt: number,
  usedRatio: number,
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
): [number, number] {
  const shown = mode === "used" ? usedRatio : 1 - usedRatio;
  const y = PLOT_BOTTOM - shown * (PLOT_BOTTOM - PLOT_TOP);
  return [timePosition(observedAt, rangeStart, rangeEnd), y];
}

function pointPosition(
  point: MetricHistoryPoint,
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
): [number, number] {
  return ratioPosition(
    point.observedAt,
    point.usedRatio,
    mode,
    rangeStart,
    rangeEnd,
  );
}

function segmentPath(
  segment: MetricHistoryPoint[],
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
): string {
  return segment
    .map((point, index) => {
      const [x, y] = pointPosition(point, mode, rangeStart, rangeEnd);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function segmentAreaPath(
  segment: MetricHistoryPoint[],
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
): string | undefined {
  if (segment.length < 2) {
    return undefined;
  }

  const firstPoint = segment[0]!;
  const lastPoint = segment.at(-1)!;
  const [firstX] = pointPosition(firstPoint, mode, rangeStart, rangeEnd);
  const [lastX] = pointPosition(lastPoint, mode, rangeStart, rangeEnd);

  return `${segmentPath(segment, mode, rangeStart, rangeEnd)} L ${lastX.toFixed(2)} ${PLOT_BOTTOM} L ${firstX.toFixed(2)} ${PLOT_BOTTOM} Z`;
}

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

function gapLabel(labelHours: number): string {
  if (labelHours >= 24) {
    const days = Math.round((labelHours / 24) * 2) / 2;
    return l10n.t("history.gapLabel", {
      duration: l10n.count("history.gapDays", days),
    });
  }

  return l10n.t("history.gapLabel", {
    duration: l10n.count("history.gapHours", Math.max(1, Math.round(labelHours))),
  });
}

function chartSummary(
  series: QuotaHistorySeries,
  mode: DisplayMode,
  observationCount: number,
  latestPercent: number,
): string {
  const parts = [
    l10n.t("history.summary", {
      observations: l10n.count("history.observations", observationCount),
      segments: l10n.count("history.segments", series.segments.length),
      percent: latestPercent,
      mode: localizeDisplayModeCompact(mode),
    }),
  ];
  if (series.bridgedSamples > 0) {
    parts.push(l10n.count("history.bridgedReads", series.bridgedSamples));
  }
  if (series.gaps.length > 0) {
    parts.push(
      l10n.count("history.longGaps", series.gaps.length, {
        labels: series.gaps.map((gap) => gapLabel(gap.labelHours)).join("; "),
      }),
    );
  }
  if (series.resets.length > 0) {
    parts.push(l10n.t("history.resetsBreak"));
  }
  if (series.limitChanges.length > 0) {
    parts.push(l10n.t("history.limitChangesBreak"));
  }
  if (series.trends.length > 0) {
    parts.push(l10n.t("history.trendEstimate"));
  }
  return parts.join(" ");
}

function formatRangeStart(
  rangeHours: number | undefined,
  rangeStart: number,
): string {
  if (rangeHours === undefined) {
    return formatDateTime(rangeStart);
  }

  if (rangeHours >= 72 && rangeHours % 24 === 0) {
    return l10n.count("history.daysAgo", rangeHours / 24);
  }

  return l10n.count("history.hoursAgo", rangeHours);
}

export function HistoryChart({
  providerName,
  mode,
  metrics,
  history,
  now,
  rangeHours,
}: HistoryChartProps) {
  const metricSelectId = useId();
  const summaryId = useId();
  const areaGradientId = useId();
  const [selectedMetricId, setSelectedMetricId] = useState(
    () => metrics[0]?.id ?? "",
  );
  useEffect(() => {
    if (!metrics.some((metric) => metric.id === selectedMetricId)) {
      setSelectedMetricId(metrics[0]?.id ?? "");
    }
  }, [selectedMetricId, metrics]);
  const selectedMetric =
    metrics.find((metric) => metric.id === selectedMetricId) ?? metrics[0];

  if (!selectedMetric) {
    return null;
  }

  const requestedRangeStart =
    rangeHours === undefined ? undefined : now - rangeHours * 60 * 60 * 1_000;
  const visibleHistory =
    requestedRangeStart === undefined
      ? history
      : history.filter((observation) => observation.observedAt >= requestedRangeStart);
  const series = quotaHistorySeries(visibleHistory, selectedMetric.id, {
    ...(rangeHours === undefined ? {} : { rangeHours }),
    now,
  });
  const segments = series.segments.map((segment) => segment.points);
  const points = segments.flat();
  const firstPoint = points[0];
  const latestPoint = points.at(-1);
  const rangeEnd = Math.max(now, latestPoint?.observedAt ?? now);
  const rangeStart = requestedRangeStart ?? firstPoint?.observedAt ?? rangeEnd;
  const latestValue = latestPoint
    ? percent(mode === "used" ? latestPoint.usedRatio : 1 - latestPoint.usedRatio)
    : undefined;
  const summary = latestPoint
    ? chartSummary(series, mode, points.length, latestValue ?? 0)
    : l10n.t("history.noMetricHistory", { label: selectedMetric.label });
  const thresholdHours = Math.round(series.gapThresholdMs / (60 * 60 * 1_000));
  const accessibleName = l10n.t("history.chartName", {
    provider: providerName,
    label: selectedMetric.label,
  });

  return (
    <div className="history-chart">
      {metrics.length > 1 ? (
        <div className="history-chart__toolbar">
          <h3>{l10n.t("common.history")}</h3>
          <label htmlFor={metricSelectId}>
            <span>{l10n.t("history.quotaMetric")}</span>
            <select
              id={metricSelectId}
              value={selectedMetric.id}
              onChange={(event) =>
                setSelectedMetricId(event.currentTarget.value)
              }
            >
              {metrics.map((metric) => (
                <option key={metric.id} value={metric.id}>
                  {metric.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {latestValue === undefined ? null : (
        <strong className="history-chart__latest">
          {l10n.t("history.latestPercent", {
            percent: latestValue,
            mode: localizeDisplayModeCompact(mode),
          })}
        </strong>
      )}

      {points.length < 2 ? (
        <p className="history-chart__empty">
          {l10n.t("history.empty")}
        </p>
      ) : (
        <svg
          className="history-chart__svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label={accessibleName}
          aria-describedby={summaryId}
        >
          <defs>
            <linearGradient
              id={areaGradientId}
              x1="0"
              y1={PLOT_TOP}
              x2="0"
              y2={PLOT_BOTTOM}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="var(--quota)" stopOpacity="0.24" />
              <stop offset="1" stopColor="var(--quota)" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          {[100, 50, 0].map((guide) => {
            const y =
              PLOT_BOTTOM - (guide / 100) * (PLOT_BOTTOM - PLOT_TOP);
            return (
              <g key={guide} className="history-chart__guide">
                <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
                <text x="0" y={y + 3}>
                  {guide}
                </text>
              </g>
            );
          })}
          {segments.map((segment, index) => {
            const areaPath = segmentAreaPath(
              segment,
              mode,
              rangeStart,
              rangeEnd,
            );
            return areaPath ? (
              <path
                className="history-chart__area"
                key={`area-${segment[0]?.observedAt ?? index}-${index}`}
                d={areaPath}
                fill={`url(#${areaGradientId})`}
              />
            ) : null;
          })}
          {series.gaps.map((gap) => {
            const from = timePosition(gap.from, rangeStart, rangeEnd);
            const to = timePosition(gap.to, rangeStart, rangeEnd);
            return (
              <g key={`${gap.from}-${gap.to}`}>
                <rect
                  className="history-chart__gap"
                  x={Math.min(from, to)}
                  y={PLOT_TOP}
                  width={Math.max(2, Math.abs(to - from))}
                  height={PLOT_BOTTOM - PLOT_TOP}
                >
                  <title>{gapLabel(gap.labelHours)}</title>
                </rect>
                <line
                  className="history-chart__gap-edge"
                  x1={from}
                  x2={from}
                  y1={PLOT_TOP}
                  y2={PLOT_BOTTOM}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {series.resets.map((resetAt) => {
            const x = timePosition(resetAt, rangeStart, rangeEnd);
            return (
              <line
                className="history-chart__reset"
                key={`reset-${resetAt}`}
                x1={x}
                x2={x}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                vectorEffect="non-scaling-stroke"
              >
                <title>{l10n.t("history.legendReset")}</title>
              </line>
            );
          })}
          {series.limitChanges.map((changeAt) => {
            const x = timePosition(changeAt, rangeStart, rangeEnd);
            return (
              <line
                className="history-chart__limit"
                key={`limit-${changeAt}`}
                x1={x}
                x2={x}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                vectorEffect="non-scaling-stroke"
              >
                <title>{l10n.t("history.limitMarker")}</title>
              </line>
            );
          })}
          {segments.map((segment, index) => (
            <path
              className="history-chart__line"
              key={`${segment[0]?.observedAt ?? index}-${index}`}
              d={segmentPath(
                segment,
                mode,
                rangeStart,
                rangeEnd,
              )}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.trends.map((trend) => {
            const [x1, y1] = ratioPosition(
              trend.from,
              trend.fromRatio,
              mode,
              rangeStart,
              rangeEnd,
            );
            const [x2, y2] = ratioPosition(
              trend.to,
              trend.toRatio,
              mode,
              rangeStart,
              rangeEnd,
            );
            return (
              <line
                className="history-chart__trend"
                key={`trend-${trend.from}-${trend.to}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {segments.map((segment, index) => {
            if (segment.length !== 1) {
              return null;
            }

            const point = segment[0]!;
            const [cx, cy] = pointPosition(
              point,
              mode,
              rangeStart,
              rangeEnd,
            );
            return (
              <circle
                className="history-chart__marker"
                key={`marker-${point.observedAt}-${index}`}
                cx={cx}
                cy={cy}
                r="3"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      )}

      {firstPoint ? (
        <p
          className="history-chart__range"
          aria-label={l10n.t("history.rangeAccessible", {
            start: formatRangeStart(rangeHours, rangeStart),
          })}
        >
          <span>{formatRangeStart(rangeHours, rangeStart)}</span>
          <span>{l10n.t("common.now")}</span>
        </p>
      ) : null}
      {points.length >= 2 ? (
        <>
          <ul className="history-chart__legend">
            <li>
              <span className="history-chart__legend-line" aria-hidden="true" />
              {l10n.t("history.legendObserved", { mode: localizeDisplayModeCompact(mode) })}
            </li>
            {series.trends.length > 0 ? (
              <li>
                <span className="history-chart__legend-trend" aria-hidden="true" />
                {l10n.t("history.legendTrend")}
              </li>
            ) : null}
            {series.gaps.length > 0 ? (
              <li>
                <span className="history-chart__legend-gap" aria-hidden="true" />
                {l10n.t("history.legendGap")}
              </li>
            ) : null}
            {series.resets.length > 0 ? (
              <li>
                <span className="history-chart__legend-reset" aria-hidden="true" />
                {l10n.t("history.legendReset")}
              </li>
            ) : null}
            {series.limitChanges.length > 0 ? (
              <li>
                <span className="history-chart__legend-limit" aria-hidden="true" />
                {l10n.t("history.legendLimit")}
              </li>
            ) : null}
          </ul>
          <p className="history-chart__footnote">
            {series.bridgedSamples > 0
              ? l10n.count("history.bridgedFootnote", series.bridgedSamples)
              : l10n.t("history.noMissedReads")}
            {l10n.t("history.gapFootnote", { hours: thresholdHours })}
          </p>
        </>
      ) : null}
      <p className="visually-hidden" id={summaryId}>
        {summary}
      </p>
    </div>
  );
}
