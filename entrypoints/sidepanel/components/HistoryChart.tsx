import React, { useId, useState } from "react";

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

export function HistoryChart({
  providerName,
  mode,
  windows,
  history,
  now,
}: HistoryChartProps) {
  const windowSelectId = useId();
  const summaryId = useId();
  const [selectedWindowId, setSelectedWindowId] = useState(
    () => windows[0]?.id ?? "",
  );
  const selectedWindow =
    windows.find((window) => window.id === selectedWindowId) ?? windows[0];

  if (!selectedWindow) {
    return null;
  }

  const segments = quotaHistorySegments(history, selectedWindow.id);
  const points = segments.flat();
  const firstPoint = points[0];
  const latestPoint = points.at(-1);
  const rangeEnd = Math.max(now, latestPoint?.observedAt ?? now);
  const latestValue = latestPoint
    ? percent(displayedRatio(latestPoint, mode))
    : undefined;
  const summary = latestPoint
    ? `${points.length} observation${points.length === 1 ? "" : "s"} across ${segments.length} chart segment${segments.length === 1 ? "" : "s"}. Latest value is ${latestValue}% ${mode}.`
    : `No ${selectedWindow.label} history is stored yet.`;
  const accessibleName = `${providerName} ${selectedWindow.label} usage history`;

  return (
    <div className="history-chart">
      <div className="history-chart__toolbar">
        <h3>History</h3>
        {windows.length > 1 ? (
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
        ) : null}
      </div>

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
          {segments.map((segment, index) => (
            <path
              className="history-chart__line"
              key={`${segment[0]?.observedAt ?? index}-${index}`}
              d={segmentPath(
                segment,
                mode,
                firstPoint!.observedAt,
                rangeEnd,
              )}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}

      {firstPoint ? (
        <p className="history-chart__range">
          History from {formatRangeTime(firstPoint.observedAt)} to{" "}
          {formatRangeTime(rangeEnd)}
        </p>
      ) : null}
      <p className="visually-hidden" id={summaryId}>
        {summary}
      </p>
    </div>
  );
}
