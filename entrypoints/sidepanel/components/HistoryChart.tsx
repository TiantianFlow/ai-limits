import React, { useEffect, useId, useState } from "react";

import { l10n } from "../../../i18n/index";
import { formatDateTime } from "../../../i18n/format";
import { localizeDisplayModeCompact } from "../../../i18n/presentation";
import {
  quotaHistorySegments,
  type MetricHistoryPoint,
  type DisplayMode,
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

function displayedRatio(point: MetricHistoryPoint, mode: DisplayMode): number {
  return mode === "used" ? point.usedRatio : 1 - point.usedRatio;
}

function pointPosition(
  point: MetricHistoryPoint,
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
): [number, number] {
  const duration = Math.max(1, rangeEnd - rangeStart);
  const x =
    PLOT_LEFT +
    ((point.observedAt - rangeStart) / duration) * (PLOT_RIGHT - PLOT_LEFT);
  const y =
    PLOT_BOTTOM - displayedRatio(point, mode) * (PLOT_BOTTOM - PLOT_TOP);

  return [x, y];
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
  const gapPatternId = useId();
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
  const segments = quotaHistorySegments(visibleHistory, selectedMetric.id);
  const points = segments.flat();
  const firstPoint = points[0];
  const latestPoint = points.at(-1);
  const rangeEnd = Math.max(now, latestPoint?.observedAt ?? now);
  const rangeStart = requestedRangeStart ?? firstPoint?.observedAt ?? rangeEnd;
  const breaks = segments.slice(1).flatMap((segment, index) => {
    const previous = segments[index]?.at(-1);
    const next = segment[0];
    return previous && next ? [{ previous, next }] : [];
  });
  const latestValue = latestPoint
    ? percent(displayedRatio(latestPoint, mode))
    : undefined;
  const summary = latestPoint
    ? l10n.t("history.summary", {
        observations: l10n.count("history.observations", points.length),
        segments: l10n.count("history.segments", segments.length),
        percent: latestValue ?? 0,
        mode: localizeDisplayModeCompact(mode),
      })
    : l10n.t("history.noMetricHistory", { label: selectedMetric.label });
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
            <pattern
              id={gapPatternId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" />
            </pattern>
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
          {breaks.map(({ previous, next }) => {
            const [from] = pointPosition(previous, mode, rangeStart, rangeEnd);
            const [to] = pointPosition(next, mode, rangeStart, rangeEnd);
            return (
              <rect
                className="history-chart__break"
                key={`${previous.observedAt}-${next.observedAt}`}
                x={Math.min(from, to)}
                y={PLOT_TOP}
                width={Math.max(2, Math.abs(to - from))}
                height={PLOT_BOTTOM - PLOT_TOP}
                fill={`url(#${gapPatternId})`}
              />
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
        <ul className="history-chart__legend">
          <li><span className="history-chart__legend-line" aria-hidden="true" />{l10n.t("history.legendObserved", { mode: localizeDisplayModeCompact(mode) })}</li>
          <li><span className="history-chart__legend-gap" aria-hidden="true" />{l10n.t("history.legendNone")}</li>
          <li><span className="history-chart__legend-break" aria-hidden="true" />{l10n.t("history.legendBreak")}</li>
        </ul>
      ) : null}
      <p className="visually-hidden" id={summaryId}>
        {summary}
      </p>
    </div>
  );
}
