import React, { useEffect, useId, useState } from "react";

import {
  quotaHistorySegments,
  type QuotaHistoryPoint,
} from "../../../domain/history";
import type {
  DisplayMode,
  QuotaHistoryObservation,
  QuotaWindow,
} from "../../../domain/model";

export interface HistoryChartProps {
  providerName: string;
  mode: DisplayMode;
  windows: QuotaWindow[];
  history: QuotaHistoryObservation[];
  now: number;
  rangeHours?: number;
}

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 112;
const PLOT_LEFT = 28;
const PLOT_RIGHT = 312;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 88;

function displayedRatio(point: QuotaHistoryPoint, mode: DisplayMode): number {
  return mode === "used" ? point.usedRatio : 1 - point.usedRatio;
}

function pointPosition(
  point: QuotaHistoryPoint,
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
  segment: QuotaHistoryPoint[],
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
  segment: QuotaHistoryPoint[],
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

function formatRangeTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRangeStart(rangeHours: number | undefined, rangeStart: number): string {
  if (rangeHours === undefined) {
    return formatRangeTime(rangeStart);
  }

  if (rangeHours >= 72 && rangeHours % 24 === 0) {
    const days = rangeHours / 24;
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return `${rangeHours} hour${rangeHours === 1 ? "" : "s"} ago`;
}

export function HistoryChart({
  providerName,
  mode,
  windows,
  history,
  now,
  rangeHours,
}: HistoryChartProps) {
  const windowSelectId = useId();
  const summaryId = useId();
  const gapPatternId = useId();
  const areaGradientId = useId();
  const [selectedWindowId, setSelectedWindowId] = useState(
    () => windows[0]?.id ?? "",
  );
  useEffect(() => {
    if (!windows.some((window) => window.id === selectedWindowId)) {
      setSelectedWindowId(windows[0]?.id ?? "");
    }
  }, [selectedWindowId, windows]);
  const selectedWindow =
    windows.find((window) => window.id === selectedWindowId) ?? windows[0];

  if (!selectedWindow) {
    return null;
  }

  const requestedRangeStart =
    rangeHours === undefined ? undefined : now - rangeHours * 60 * 60 * 1_000;
  const visibleHistory =
    requestedRangeStart === undefined
      ? history
      : history.filter((observation) => observation.observedAt >= requestedRangeStart);
  const segments = quotaHistorySegments(visibleHistory, selectedWindow.id);
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
    ? `${points.length} observation${points.length === 1 ? "" : "s"} across ${segments.length} chart segment${segments.length === 1 ? "" : "s"}. Latest value is ${latestValue}% ${mode}.`
    : `No ${selectedWindow.label} history is stored yet.`;
  const accessibleName = `${providerName} ${selectedWindow.label} usage history`;

  return (
    <div className="history-chart">
      {windows.length > 1 ? (
        <div className="history-chart__toolbar">
          <h3>History</h3>
          <label htmlFor={windowSelectId}>
            <span>Quota window</span>
            <select
              id={windowSelectId}
              value={selectedWindow.id}
              onChange={(event) =>
                setSelectedWindowId(event.currentTarget.value)
              }
            >
              {windows.map((window) => (
                <option key={window.id} value={window.id}>
                  {window.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {latestValue === undefined ? null : (
        <strong className="history-chart__latest">
          {latestValue}% {mode}
        </strong>
      )}

      {points.length < 2 ? (
        <p className="history-chart__empty">
          History starts after another successful refresh.
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
          aria-label={`History range from ${formatRangeStart(rangeHours, rangeStart)} to now`}
        >
          <span>{formatRangeStart(rangeHours, rangeStart)}</span>
          <span>Now</span>
        </p>
      ) : null}
      {points.length >= 2 ? (
        <ul className="history-chart__legend">
          <li><span className="history-chart__legend-line" aria-hidden="true" />Observed quota {mode}</li>
          <li><span className="history-chart__legend-gap" aria-hidden="true" />No observations</li>
          <li><span className="history-chart__legend-break" aria-hidden="true" />Reset or missing observations · line breaks</li>
        </ul>
      ) : null}
      <p className="visually-hidden" id={summaryId}>
        {summary}
      </p>
    </div>
  );
}
