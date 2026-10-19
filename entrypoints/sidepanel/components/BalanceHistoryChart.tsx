import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";
import { formatAmount, formatDateTime } from "../../../i18n/format";
import {
  balanceAxisMax,
  balanceHistorySeries,
  type BalanceHistoryPoint,
  type BalanceHistorySeries,
  type BalanceMetric,
  type UsageHistoryObservation,
} from "../../../domain/public-protocol";
import {
  dateTicks,
  durationText,
  timeX,
  MARK_Y,
  PLOT_BOTTOM,
  PLOT_HEIGHT,
  PLOT_LEFT,
  PLOT_RIGHT,
  PLOT_TOP,
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
  type Focus,
} from "./HistoryChart";

export interface BalanceHistoryChartProps {
  providerName: string;
  metric: BalanceMetric;
  history: UsageHistoryObservation[];
  now: number;
  rangeHours?: number;
}

const HOUR_MS = 60 * 60 * 1_000;

function signedAmount(change: number, unit: string): string {
  const amount = formatAmount(Math.abs(change), unit);
  return change < 0 ? `−${amount}` : `+${amount}`;
}

/** Change smaller than half a cent reads as no change. */
function noChange(change: number): boolean {
  return Math.abs(change) < 0.005;
}

function rangeText(hours: number): string {
  return hours % 24 === 0 && hours >= 72
    ? l10n.count("history.footnoteDays", hours / 24)
    : l10n.count("history.footnoteHours", hours);
}

export function balanceStatus(series: BalanceHistorySeries, hours: number): string {
  const range = rangeText(hours);
  if (series.points.length === 0) return l10n.t("history.noteNone", { range });
  if (series.change === undefined || series.unit === undefined) {
    return l10n.t("history.balance.statusOneReading", { range });
  }
  if (noChange(series.change)) return l10n.t("history.balance.statusNoChange", { range });
  return l10n.t("history.balance.statusChange", {
    change: signedAmount(series.change, series.unit),
    range,
  });
}

function readingLines(point: BalanceHistoryPoint, unit: string): string[] {
  const lines = [formatDateTime(point.observedAt), formatAmount(point.value, unit)];
  if (point.topUp !== undefined) {
    lines.push(l10n.t("history.balance.topUp", { amount: formatAmount(point.topUp, unit) }));
  }
  return lines;
}

export function BalanceHistoryChart({
  providerName,
  metric,
  history,
  now,
  rangeHours,
}: BalanceHistoryChartProps) {
  const summaryId = useId();
  const infoId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(360);
  const [hover, setHover] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const [keyIndex, setKeyIndex] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = (): void => setPlotWidth(element.clientWidth || 360);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHover(null);
    setPinned(null);
    setKeyIndex(null);
  }, [metric.id, rangeHours]);

  const hours = rangeHours ?? 30 * 24;
  const rangeEnd = now;
  const rangeStart = now - hours * HOUR_MS;
  const series = useMemo(
    () => balanceHistorySeries(history, metric.id, rangeStart, rangeEnd),
    [history, metric.id, rangeStart, rangeEnd],
  );
  const unit = series.unit ?? metric.unit;
  const axisMax = balanceAxisMax([...series.points.map((point) => point.value), metric.value]);
  const valueY = (value: number): number =>
    PLOT_BOTTOM - (Math.min(axisMax, Math.max(0, value)) / axisMax) * PLOT_HEIGHT;
  const x = (at: number): number => timeX(at, rangeStart, rangeEnd);

  const stops: Focus[] = series.points.map((point, index) => ({
    id: `reading-${index}`,
    title: formatDateTime(point.observedAt),
    lines: readingLines(point, unit),
    x: x(point.observedAt),
    y: valueY(point.value),
    from: point.observedAt,
    to: point.observedAt,
  }));

  function focusAt(at: number): Focus | null {
    const pxPerHour = Math.max(1, plotWidth) / Math.max(1, hours);
    const tolerance = Math.min(15 * 60 * 1_000, (8 / pxPerHour) * HOUR_MS);
    const gap = series.gaps.find((span) => (at - span.start) * (span.end - at) > 0);
    let best = -1;
    series.points.forEach((point, index) => {
      if (best < 0 || Math.abs(point.observedAt - at) < Math.abs(series.points[best]!.observedAt - at)) best = index;
    });
    const nearest = series.points[best];
    if (nearest && Math.abs(nearest.observedAt - at) <= tolerance) return stops[best]!;
    if (gap) {
      return {
        id: `gap-${gap.start}`,
        title: l10n.t("history.spanUnknownTitle"),
        lines: [
          l10n.t("history.spanUnknownTitle"),
          `${formatDateTime(gap.start)} – ${formatDateTime(gap.end)}`,
          l10n.t("history.gapDuration", { duration: durationText(gap.end - gap.start) }),
        ],
        from: gap.start,
        to: gap.end,
      };
    }
    const nextIndex = series.points.findIndex((point) => point.observedAt > at);
    if (nextIndex <= 0) return null;
    const left = series.points[nextIndex - 1]!;
    const right = series.points[nextIndex]!;
    // A rise is a step at the later reading, so the earlier value holds until then.
    const rising = right.value > left.value;
    const fraction = (at - left.observedAt) / Math.max(1, right.observedAt - left.observedAt);
    const value = rising ? left.value : left.value + (right.value - left.value) * fraction;
    return {
      id: `span-${nextIndex}`,
      title: formatDateTime(at),
      lines: [
        formatDateTime(at),
        rising || left.value === right.value
          ? formatAmount(left.value, unit)
          : l10n.t("history.readBetween", {
              low: formatAmount(right.value, unit),
              high: formatAmount(left.value, unit),
            }),
      ],
      x: x(at),
      y: valueY(value),
      from: at,
      to: at,
    };
  }

  function atClientX(clientX: number): Focus | null {
    const canvas = canvasRef.current;
    if (!(canvas instanceof Element)) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const viewX = ((clientX - bounds.left) / bounds.width) * VIEWBOX_WIDTH;
    if (viewX < PLOT_LEFT || viewX > PLOT_RIGHT) return null;
    return focusAt(rangeStart + ((viewX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT)) * (rangeEnd - rangeStart));
  }

  function move(step: number): void {
    if (stops.length === 0) return;
    setHover(null);
    setPinned(null);
    setKeyIndex((index) => {
      const base = index ?? (step > 0 ? -1 : stops.length);
      return Math.max(0, Math.min(stops.length - 1, base + step));
    });
  }

  const active = hover ?? pinned ?? (keyIndex !== null ? stops[keyIndex] ?? null : null);
  const note = series.points.length === 0
    ? l10n.t("history.noteNone", { range: rangeText(hours) })
    : series.points.length < 5
      ? l10n.count("history.noteReadings", series.points.length, { range: rangeText(hours) })
      : null;
  const info = [
    l10n.t("history.balance.infoLine"),
    series.topUps > 0 ? l10n.t("history.balance.infoTopUp") : "",
    series.gaps.length > 0 ? l10n.t("history.infoGaps") : "",
    l10n.count("history.infoStored", series.points.length),
  ].filter((item) => item.length > 0);
  const tooltipLeft = active?.x !== undefined
    ? Math.max(0, Math.min(VIEWBOX_WIDTH - 150, active.x - 75))
    : Math.max(0, Math.min(VIEWBOX_WIDTH - 150, (x(active?.from ?? rangeStart) + x(active?.to ?? rangeEnd)) / 2 - 75));
  const newest = series.points.at(-1);

  return (
    <div className="history-chart history-chart--balance" ref={chartRef}>
      <div className="history-chart__head">
        <h3 className="history-chart__title">{metric.label}</h3>
        <div className="history-chart__value">
          <p className="history-chart__latest">{formatAmount(metric.value, metric.unit)}</p>
          <button
            type="button"
            className="history-chart__info"
            aria-expanded={infoOpen}
            aria-controls={infoId}
            aria-label={l10n.t("history.infoLabel", { label: metric.label })}
            onClick={() => setInfoOpen((open) => !open)}
          >
            {l10n.t("history.infoMark")}
          </button>
        </div>
      </div>
      <p className="history-chart__status">{balanceStatus(series, hours)}</p>
      {infoOpen ? (
        <ul id={infoId} className="history-chart__info-list">
          {info.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      <div className="history-chart__plot">
        <div
          className="history-chart__canvas"
          ref={canvasRef}
          role="group"
          tabIndex={0}
          aria-roledescription={l10n.t("history.chartRole")}
          aria-label={l10n.t("history.balance.chartName", { provider: providerName, label: metric.label })}
          aria-describedby={summaryId}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
            else if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
            else if (event.key === "Home") { event.preventDefault(); setKeyIndex(stops.length > 0 ? 0 : null); }
            else if (event.key === "End") { event.preventDefault(); setKeyIndex(stops.length > 0 ? stops.length - 1 : null); }
            else if (event.key === "Escape") { setHover(null); setPinned(null); setKeyIndex(null); }
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "touch") return;
            setHover(atClientX(event.clientX));
          }}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => {
            const next = atClientX(event.clientX);
            setPinned((current) => (current && next && current.id === next.id ? null : next));
            setKeyIndex(null);
          }}
        >
          <svg className="history-chart__svg" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} aria-hidden="true">
            <line className="history-chart__axis" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_TOP} y2={PLOT_TOP} strokeDasharray="2 3" />
            <line className="history-chart__axis" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />
            {series.runs.map((run) => {
              const first = run[0]!;
              let line = `M${x(first.observedAt)} ${valueY(first.value)}`;
              run.slice(1).forEach((point, step) => {
                const previous = run[step]!;
                // A top-up or credit lands between two readings, so it draws as a step up.
                if (point.value > previous.value) line += ` L${x(point.observedAt)} ${valueY(previous.value)}`;
                line += ` L${x(point.observedAt)} ${valueY(point.value)}`;
              });
              const last = run.at(-1)!;
              const fill = `M${x(first.observedAt)} ${PLOT_BOTTOM} ${line.replace(/^M/, "L")} L${x(last.observedAt)} ${PLOT_BOTTOM}Z`;
              return (
                <g key={first.observedAt}>
                  <path className="history-chart__area" d={fill} />
                  <path className="history-chart__line" d={line} />
                  {run.length === 1 ? (
                    <circle className="history-chart__dot" cx={x(first.observedAt)} cy={valueY(first.value)} r="2" />
                  ) : null}
                </g>
              );
            })}
            {series.gaps.map((gap) => (
              <line
                key={`gap-${gap.start}`}
                className="history-chart__gap"
                x1={x(gap.start)}
                x2={x(gap.end)}
                y1={MARK_Y}
                y2={MARK_Y}
                strokeDasharray="2 3"
              />
            ))}
            {newest ? (
              <circle className="history-chart__now" cx={x(newest.observedAt)} cy={valueY(newest.value)} r="3" />
            ) : null}
            {dateTicks(rangeStart, rangeEnd).map((tick) => (
              <text key={tick.at} className="history-chart__tick" x={x(tick.at)} y={128} textAnchor="middle">
                {tick.label}
              </text>
            ))}
            <text className="history-chart__tick" x={PLOT_RIGHT - 2} y={PLOT_TOP - 2} textAnchor="end">
              {formatAmount(axisMax, unit)}
            </text>
            <text className="history-chart__tick" x={PLOT_RIGHT} y={128} textAnchor="end">{l10n.t("common.now")}</text>
            {active?.x !== undefined ? (
              <g>
                <line className="history-chart__guide-active" x1={active.x} x2={active.x} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
                {active.y !== undefined ? <circle className="history-chart__dot-active" cx={active.x} cy={active.y} r="3.5" /> : null}
              </g>
            ) : null}
            {active && active.x === undefined ? (
              <rect
                className="history-chart__highlight"
                x={x(active.from)}
                y={PLOT_TOP}
                width={Math.max(1, x(active.to) - x(active.from))}
                height={PLOT_HEIGHT}
              />
            ) : null}
          </svg>
          {note && !active ? <p className="history-chart__note">{note}</p> : null}
          {active ? (
            <div
              className="history-chart__tooltip"
              role="tooltip"
              style={{ left: `${(tooltipLeft / VIEWBOX_WIDTH) * 100}%` }}
            >
              {active.lines.map((line) => <p key={line}>{line}</p>)}
            </div>
          ) : null}
        </div>
      </div>
      <p className="visually-hidden" id={summaryId}>{l10n.t("history.balance.summaryKeys")}</p>
    </div>
  );
}
