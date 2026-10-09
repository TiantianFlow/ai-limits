import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";
import { formatDateTime, formatPercent as formatPercentNumber } from "../../../i18n/format";
import { localizeDisplayModeCompact } from "../../../i18n/presentation";
import {
  buildEnvelopeSeries,
  dailyBuckets,
  detailLevel,
  meterPolicy,
  predictUsed,
  windowBar,
  DOT_JOIN_PX,
  expectedIntervalMs,
  OPEN_STUB_PX,
  type DayBucket,
  type DetailLevel,
  type DisplayMode,
  type EnvelopeBand,
  type EnvelopeSeries,
  type IdleSpan,
  type QuotaMetric,
  type UsageHistoryObservation,
  type WindowSpan,
  type ProviderKind,
} from "../../../domain/public-protocol";

export interface HistoryChartProps {
  providerName: string;
  providerKind?: ProviderKind;
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
const PLOT_BOTTOM = 92;
const TOOLTIP_MAX = 204;

type InspectItem =
  | { kind: "window"; id: string }
  | { kind: "span"; id: string }
  | { kind: "day"; id: string };

/** One x scale for every mark: range start..end maps to the plot's left..right. */
function timeX(at: number, rangeStart: number, rangeEnd: number): number {
  const duration = Math.max(1, rangeEnd - rangeStart);
  const clamped = Math.min(rangeEnd, Math.max(rangeStart, at));
  return PLOT_LEFT + ((clamped - rangeStart) / duration) * (PLOT_RIGHT - PLOT_LEFT);
}

function clampInterval(
  from: number,
  to: number,
  rangeStart: number,
  rangeEnd: number,
): { from: number; to: number } | null {
  const start = Math.max(rangeStart, Math.min(from, to));
  const end = Math.min(rangeEnd, Math.max(from, to));
  if (end - start < 0) return null;
  return { from: start, to: end };
}

function leftY(leftPercent: number): number {
  const clamped = Math.min(100, Math.max(0, leftPercent));
  return PLOT_BOTTOM - (clamped / 100) * (PLOT_BOTTOM - PLOT_TOP);
}

function shownY(leftPercent: number, mode: DisplayMode): number {
  return mode === "left" ? leftY(leftPercent) : leftY(100 - leftPercent);
}

function percent(value: number): number {
  return Math.round(value);
}

function bandPath(band: EnvelopeBand, mode: DisplayMode, rangeStart: number, rangeEnd: number): string | null {
  const span = clampInterval(band.from, band.to, rangeStart, rangeEnd);
  if (!span) return null;
  const x1 = timeX(span.from, rangeStart, rangeEnd);
  const x2 = timeX(span.to, rangeStart, rangeEnd);
  const yUpper = shownY(band.upper, mode);
  const yLower = shownY(band.lower, mode);
  const top = Math.min(yUpper, yLower);
  const bottom = Math.max(yUpper, yLower);
  return `M ${x1.toFixed(2)} ${top.toFixed(2)} L ${x2.toFixed(2)} ${top.toFixed(2)} L ${x2.toFixed(2)} ${bottom.toFixed(2)} L ${x1.toFixed(2)} ${bottom.toFixed(2)} Z`;
}

function formatSpan(start: number, end: number, current: boolean): string {
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  if (current) {
    return l10n.t("history.windowNow", {
      start: formatDateTime(start),
      end: formatDateTime(end),
    });
  }
  if (sameDay) {
    return l10n.t("history.windowSameDay", {
      start: formatDateTime(start),
      end: formatClock(end),
    });
  }
  return l10n.t("history.windowAcrossDays", {
    start: formatDateTime(start),
    end: formatDateTime(end),
  });
}

function formatClock(value: number): string {
  return new Intl.DateTimeFormat(l10n.localeTag(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: number): string {
  return new Intl.DateTimeFormat(l10n.localeTag(), {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return l10n.count("history.durationMinutes", minutes);
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return l10n.count("history.durationHours", Math.max(1, hours));
  return l10n.count("history.durationDays", Math.max(1, Math.round(hours / 24)));
}

function isNamedHourWindow(hours: number): boolean {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].includes(hours);
}

function windowNoun(windowMs: number): string {
  const hours = Math.round(windowMs / 3_600_000);
  if (isNamedHourWindow(hours)) {
    return l10n.t("history.nounHours", { hours: String(hours) });
  }
  if (hours === 168) return l10n.t("history.nounWeek");
  return l10n.t("history.nounWindow");
}

function observedRange(values: number[], mode: DisplayMode): string {
  const shown = values.map((left) => (mode === "left" ? left : 100 - left));
  const low = Math.min(...shown);
  const high = Math.max(...shown);
  const modeLabel = localizeDisplayModeCompact(mode);
  if (Math.abs(high - low) < 0.5) {
    return l10n.t("history.observedSingle", {
      value: percent(shown[0] ?? 0),
      mode: modeLabel,
    });
  }
  return l10n.t("history.observedRange", {
    low: percent(Math.min(low, high)),
    high: percent(Math.max(low, high)),
    mode: modeLabel,
  });
}

function windowTooltip(
  window: WindowSpan,
  mode: DisplayMode,
  now: number,
): string[] {
  const lines = [formatSpan(window.start, window.end, window.current)];
  if (window.kind === "unknown") {
    lines.push(l10n.t("history.tooltipNoReadings"));
    lines.push(l10n.t("history.tooltipPossibleRange"));
    return lines;
  }
  lines.push(l10n.count("history.readingsInWindow", window.readings.length));
  if (window.values.length > 0) lines.push(observedRange(window.values, mode));
  const last = window.readings.at(-1);
  const endValue = window.values.at(-1);
  // The current window's end is its reset, which can be days ahead of now.
  // "No reading in the last …" is the gap since the last reading, not the
  // time left until that reset.
  const sinceLast = last ? Math.max(0, now - last.observedAt) : 0;
  if (window.current && window.tailTrusted) {
    lines.push(l10n.t("history.tooltipLatestCurrent"));
  } else if (window.current && last && sinceLast > 0) {
    lines.push(l10n.t("history.tooltipCurrentOpen", {
      duration: formatDuration(sinceLast),
    }));
  } else if (window.tailTrusted && endValue !== undefined) {
    lines.push(l10n.t("history.tooltipEnded", {
      value: percent(mode === "left" ? endValue : 100 - endValue),
      mode: localizeDisplayModeCompact(mode),
    }));
  } else if (last) {
    lines.push(l10n.t("history.tooltipOpenEnd", {
      duration: formatDuration(Math.max(0, window.end - last.observedAt)),
    }));
  }
  if (window.hasEvent) lines.push(l10n.t("history.tooltipEvent"));
  return lines;
}

function dayTooltip(bucket: DayBucket, mode: DisplayMode, policy: EnvelopeSeries["policy"]): string[] {
  const title = bucket.today
    ? l10n.t("history.dayToday", { day: formatDay(bucket.start) })
    : formatDay(bucket.start);
  if (!bucket.window) {
    return [title, l10n.t(policy === "first-use" ? "history.dayIdle" : "history.dayNone")];
  }
  const bar = windowBar(bucket.window);
  const lines = [
    title,
    l10n.t("history.dayBusiest", {
      noun: windowNoun(bucket.window.windowMs),
      span: formatSpan(bucket.window.start, bucket.window.end, false),
    }),
  ];
  if (bucket.window.values.length > 0) {
    const observed = observedRange(bucket.window.values, mode);
    lines.push(bucket.window.tailTrusted
      ? observed
      : l10n.t("history.dayOpen", { observed }));
  }
  return lines;
}

function spanTooltip(span: IdleSpan, mode: DisplayMode): string[] {
  if (span.kind === "unknown") {
    return [l10n.t("history.spanUnknownTitle"), l10n.t("history.spanUnknownBody")];
  }
  const lines = [l10n.t("history.spanIdle", { mode: localizeDisplayModeCompact(mode) })];
  lines.push(span.proofReadings > 0
    ? l10n.count("history.spanConfirmed", span.proofReadings)
    : l10n.t("history.spanShort"));
  return lines;
}

function defaultRangeHours(metrics: QuotaMetric[], metricId: string, providerKind?: ProviderKind): number {
  const metric = metrics.find((candidate) => candidate.id === metricId);
  const listed = meterPolicy(providerKind, metricId);
  const windowMs = listed?.windowMs ?? metric?.cycle?.durationMs ?? 0;
  const dayMs = 24 * 60 * 60 * 1_000;
  const shortWindow = windowMs > 0 && !(windowMs > dayMs);
  return shortWindow ? 7 * 24 : 30 * 24;
}

export function HistoryChart({
  providerName,
  providerKind,
  mode,
  metrics,
  history,
  now,
  rangeHours,
}: HistoryChartProps) {
  const summaryId = useId();
  const clipId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(360);
  const [cardWidth, setCardWidth] = useState(360);
  const [active, setActive] = useState<InspectItem | null>(null);
  const [pinned, setPinned] = useState(false);
  const [selectedMetricId, setSelectedMetricId] = useState(() => metrics[0]?.id ?? "");

  useEffect(() => {
    if (!metrics.some((metric) => metric.id === selectedMetricId)) {
      setSelectedMetricId(metrics[0]?.id ?? "");
    }
  }, [selectedMetricId, metrics]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = (): void => {
      const plot = element.querySelector(".history-chart__plot");
      setPlotWidth((plot ?? element).clientWidth || 360);
      const card = element.closest(".history-surface");
      setCardWidth((card instanceof HTMLElement ? card.clientWidth : element.clientWidth) || 360);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const plot = element.querySelector(".history-chart__plot");
    if (plot) observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? metrics[0];
  const resolvedRange = rangeHours ?? (selectedMetric
    ? defaultRangeHours(metrics, selectedMetric.id, providerKind)
    : 30 * 24);
  const rangeEnd = now;
  const rangeStart = now - resolvedRange * 60 * 60 * 1_000;

  const series = useMemo(() => {
    if (!selectedMetric) return undefined;
    const omitted = history.filter((observation) =>
      !observation.metrics.some(
        (sample) => sample.type === "quota" && sample.metricId === selectedMetric.id,
      ),
    );
    return buildEnvelopeSeries(history, {
      ...(providerKind ? { providerKind } : {}),
      metricId: selectedMetric.id,
      now,
      rangeStart,
      rangeEnd,
      omittedObservations: omitted,
    });
  }, [history, selectedMetric, providerKind, now, rangeStart, rangeEnd]);

  const level: DetailLevel = series
    ? detailLevel(series.windowMs || 60 * 60 * 1_000, rangeEnd - rangeStart, Math.max(1, plotWidth - 36))
    : "bars";
  const days = useMemo(
    () => (series && level === "daily"
      ? dailyBuckets(series.spans, rangeStart, rangeEnd, now)
      : []),
    [series, level, rangeStart, rangeEnd, now],
  );

  if (!selectedMetric || !series) return null;

  const items = inspectItems(series, days, level, mode, now);
  const activeItem = items.find((item) => item.id === active?.id) ?? null;
  const readings = series.readingsInRange;
  const withReadings = series.spans.filter((window) => window.kind === "observed").length;
  const withoutReadings = series.spans.filter((window) => window.kind === "unknown").length;
  const openEnds = series.spans.filter((window) => window.kind === "observed" && !window.tailTrusted).length;
  const summary = chartSummary({
    meter: selectedMetric.label,
    range: formatRangeStart(resolvedRange),
    mode,
    readings,
    withReadings,
    withoutReadings,
    openEnds,
    level,
    noun: windowNoun(series.windowMs),
    idle: series.idleSpans.some((span) => span.kind === "idle"),
    events: series.events.length,
    trend: series.trend,
  });

  function move(step: number): void {
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.id === active?.id);
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, index + step));
    const item = items[next];
    if (!item) return;
    setActive({ kind: item.kind, id: item.id });
    setPinned(true);
  }

  function itemAtClientX(clientX: number): Inspectable | undefined {
    const canvas = chartRef.current?.querySelector(".history-chart__canvas");
    if (!canvas) return undefined;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0) return undefined;
    const viewX = ((clientX - bounds.left) / bounds.width) * VIEWBOX_WIDTH;
    const hits = items.filter((item) => {
      const span = clampInterval(item.from, item.to, rangeStart, rangeEnd);
      if (!span) return false;
      const left = timeX(span.from, rangeStart, rangeEnd);
      const right = timeX(span.to, rangeStart, rangeEnd);
      const start = Math.min(left, right);
      const end = Math.max(left, right);
      const afterStart = viewX >= start;
      const beforeEnd = viewX <= end;
      return afterStart && beforeEnd;
    });
    // Overlapping targets (a window and the outline merged across it) would
    // otherwise highlight a span whose tooltip belongs to a different item.
    return hits.sort((left, right) => (left.to - left.from) - (right.to - right.from))[0];
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (pinned || event.pointerType === "touch") return;
    const item = itemAtClientX(event.clientX);
    setActive(item ? { kind: item.kind, id: item.id } : null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = items[0];
      if (first) {
        setActive({ kind: first.kind, id: first.id });
        setPinned(true);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      const last = items.at(-1);
      if (last) {
        setActive({ kind: last.kind, id: last.id });
        setPinned(true);
      }
    } else if (event.key === "Escape") {
      setActive(null);
      setPinned(false);
    }
  }

  const empty = readings === 0;
  const tooltip = activeItem?.lines ?? null;
  const tooltipAnchor = activeItem
    ? tooltipPosition(activeItem.from, activeItem.to, rangeStart, rangeEnd, plotWidth, cardWidth)
    : null;

  return (
    <div className="history-chart" ref={chartRef}>
      {empty ? null : (
        <strong className="history-chart__latest">
          {(() => {
            const headline = currentWindowHeadline(series, mode);
            // Idle still reports the same percent the Current cycle card shows.
            if (headline.idle) {
              return `${l10n.t("history.latestPercent", {
                percent: headline.label,
                mode: localizeDisplayModeCompact(mode),
              })} · ${l10n.t("history.headlineIdle")}`;
            }
            return l10n.t("history.latestPercent", {
              percent: headline.label,
              mode: localizeDisplayModeCompact(mode),
            });
          })()}
        </strong>
      )}
      {empty ? (
        <p className="history-chart__empty">{l10n.t("history.empty")}</p>
      ) : (
        <div className="history-chart__plot">
          <div
            className="history-chart__canvas"
            role="group"
            tabIndex={0}
            aria-roledescription={l10n.t("history.chartRole")}
            aria-label={l10n.t("history.chartName", {
              provider: providerName,
              label: selectedMetric.label,
            })}
            aria-describedby={empty ? undefined : summaryId}
            onKeyDown={onKeyDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => {
              if (!pinned) setActive(null);
            }}
          >
            <svg
              className="history-chart__svg"
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              aria-hidden="true"
            >
              <defs>
                <clipPath id={clipId}>
                  <rect
                    x={PLOT_LEFT}
                    y={PLOT_TOP}
                    width={PLOT_RIGHT - PLOT_LEFT}
                    height={PLOT_BOTTOM - PLOT_TOP}
                  />
                </clipPath>
              </defs>
              {[100, 50, 0].map((guide) => {
                const y = leftY(guide);
                return (
                  <g key={guide} className="history-chart__guide">
                    <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
                    <text x="0" y={y + 3}>{String(guide)}</text>
                  </g>
                );
              })}
              <g clipPath={`url(#${clipId})`}>
                {level === "envelope"
                  ? <EnvelopeLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} plotWidth={plotWidth} now={now} />
                  : null}
                {level === "bars"
                  ? <BarsLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} />
                  : null}
                {level === "daily"
                  ? <DailyLayer days={days} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} />
                  : null}
                <TrendLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} />
                {activeItem ? (
                  <Highlight
                    from={activeItem.from}
                    to={activeItem.to}
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                  />
                ) : null}
              </g>
            </svg>
            <div className="history-chart__hits">
              {items.map((item) => {
                const span = clampInterval(item.from, item.to, rangeStart, rangeEnd);
                if (!span) return null;
                const left = timeX(span.from, rangeStart, rangeEnd);
                const right = timeX(span.to, rangeStart, rangeEnd);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="history-chart__hit"
                    tabIndex={-1}
                    aria-label={item.lines[0]}
                    style={{
                      left: `${(Math.min(left, right) / VIEWBOX_WIDTH) * 100}%`,
                      width: `${(Math.max(1, Math.abs(right - left)) / VIEWBOX_WIDTH) * 100}%`,
                    }}
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      chartRef.current?.querySelector<HTMLElement>(".history-chart__canvas")?.focus();
                    }}
                    onClick={() => {
                      const same = pinned && active?.id === item.id;
                      setPinned(!same);
                      setActive(same ? null : { kind: item.kind, id: item.id });
                    }}
                  />
                );
              })}
            </div>
            {tooltip && tooltipAnchor ? (
              <div
                className="history-chart__tooltip"
                role="tooltip"
                style={{ left: tooltipAnchor.left, top: 4, width: tooltipAnchor.width }}
              >
                {tooltip.map((line) => <p key={line}>{line}</p>)}
              </div>
            ) : null}
          </div>
          <p className="visually-hidden" aria-live="polite">
            {activeItem ? activeItem.lines.join(" ") : ""}
          </p>
        </div>
      )}
      {empty ? null : (
        <>
          <p
            className="history-chart__range"
            aria-label={l10n.t("history.rangeAccessible", { start: formatRangeStart(resolvedRange) })}
          >
            <span>{formatRangeStart(resolvedRange)}</span>
            <span>{l10n.t("common.now")}</span>
          </p>
          <Legend series={series} level={level} mode={mode} />
          <p className="history-chart__footnote">{footnote(series, level, resolvedRange)}</p>
        </>
      )}
      {empty ? null : <p className="visually-hidden" id={summaryId}>{summary}</p>}
    </div>
  );
}

/**
 * Headline for the chart. The current window's latest reading, matching the
 * Current cycle card. Idle (no window contains now) reports a full quota.
 */
export function currentWindowHeadline(
  series: EnvelopeSeries,
  mode: DisplayMode,
): { label: string; idle: boolean } {
  const current = series.spans.find(
    (window) => window.current && window.kind === "observed" && window.values.length > 0,
  );
  if (!current) {
    return { label: formatPercentNumber(mode === "left" ? 100 : 0), idle: true };
  }
  const left = current.values.at(-1) ?? 100;
  const shown = mode === "left" ? left : 100 - left;
  // Same rounding the Current cycle card uses, so 0.03% does not become 0%.
  return { label: formatPercentNumber(Number(shown.toFixed(4))), idle: false };
}

function formatRangeStart(rangeHours: number): string {
  if (rangeHours >= 72 && rangeHours % 24 === 0) {
    return l10n.count("history.daysAgo", rangeHours / 24);
  }
  return l10n.count("history.hoursAgo", rangeHours);
}

interface Inspectable {
  kind: InspectItem["kind"];
  id: string;
  from: number;
  to: number;
  lines: string[];
}

function inspectItems(
  series: EnvelopeSeries,
  days: DayBucket[],
  level: DetailLevel,
  mode: DisplayMode,
  now: number,
): Inspectable[] {
  if (level === "daily") {
    return days.map((bucket) => ({
      kind: "day" as const,
      id: `day-${bucket.start}`,
      from: bucket.start,
      to: bucket.end,
      lines: dayTooltip(bucket, mode, series.policy),
    }));
  }
  const quotaSpans = series.spans.map((window) => ({
    kind: "window" as const,
    id: window.id,
    from: window.start,
    to: window.end,
    lines: windowTooltip(window, mode, now),
  }));
  const gaps = [...series.idleSpans, ...series.unknownRuns].map((span, index) => ({
    kind: "span" as const,
    id: `span-${span.start}-${span.end}-${index}`,
    from: Math.min(span.start, span.end),
    to: Math.max(span.start, span.end),
    lines: spanTooltip(span, mode),
  }));
  return [...quotaSpans, ...gaps].sort((left, right) => left.from - right.from);
}

function Highlight({
  from,
  to,
  rangeStart,
  rangeEnd,
}: {
  from: number;
  to: number;
  rangeStart: number;
  rangeEnd: number;
}) {
  const span = clampInterval(from, to, rangeStart, rangeEnd);
  if (!span) return null;
  const left = timeX(span.from, rangeStart, rangeEnd);
  const right = timeX(span.to, rangeStart, rangeEnd);
  return (
    <rect
      className="history-chart__highlight"
      x={left}
      y={PLOT_TOP}
      width={Math.max(1, right - left)}
      height={PLOT_BOTTOM - PLOT_TOP}
    />
  );
}

function tooltipPosition(
  from: number,
  to: number,
  rangeStart: number,
  rangeEnd: number,
  plotWidth: number,
  cardWidth: number,
): { left: number; width: number } {
  const span = clampInterval(from, to, rangeStart, rangeEnd) ?? { from, to };
  const mid = (timeX(span.from, rangeStart, rangeEnd) + timeX(span.to, rangeStart, rangeEnd)) / 2;
  const center = (mid / VIEWBOX_WIDTH) * plotWidth;
  const width = Math.min(TOOLTIP_MAX, Math.max(80, cardWidth - 8));
  const left = Math.min(Math.max(0, center - width / 2), Math.max(0, plotWidth - width));
  return { left, width };
}

function chartSummary(input: {
  meter: string;
  range: string;
  mode: DisplayMode;
  readings: number;
  withReadings: number;
  withoutReadings: number;
  openEnds: number;
  level: DetailLevel;
  noun: string;
  idle: boolean;
  events: number;
  trend: EnvelopeSeries["trend"];
}): string {
  const windows = input.withoutReadings > 0
    ? l10n.t("history.summaryWindowsSome", {
        readings: input.readings,
        withReadings: input.withReadings,
        without: input.withoutReadings,
      })
    : l10n.t("history.summaryWindows", {
        readings: input.readings,
        withReadings: input.withReadings,
      });
  const parts = [
    l10n.t("history.summaryLead", {
      meter: input.meter,
      range: input.range,
      mode: localizeDisplayModeCompact(input.mode),
    }),
    windows,
  ];
  if (input.openEnds > 0) {
    parts.push(l10n.count("history.summaryOpen", input.openEnds));
  }
  parts.push(input.level === "envelope"
    ? l10n.t("history.summaryEnvelope")
    : l10n.t(
        input.level === "daily" ? "history.summaryDaily" : "history.summaryBars",
        { noun: input.noun },
      ));
  if (input.idle) parts.push(l10n.t("history.summaryIdle"));
  if (input.events > 0) parts.push(l10n.count("history.summaryEvents", input.events));
  if (input.trend.fit) parts.push(l10n.t("history.summaryTrend"));
  else if (input.trend.reason === "count") {
    parts.push(l10n.t("history.trendNeedsCount", { count: input.trend.points.length }));
  } else if (input.trend.reason === "span") {
    parts.push(l10n.t("history.trendNeedsSpan", { count: input.trend.points.length }));
  }
  parts.push(l10n.t(input.level === "daily" ? "history.summaryKeysDays" : "history.summaryKeys"));
  return parts.join(" ");
}

function footnote(series: EnvelopeSeries, level: DetailLevel, rangeHours: number): string {
  const noun = windowNoun(series.windowMs);
  const lead = level === "daily"
    ? l10n.t("history.footnoteDaily", { noun })
    : level === "bars"
      ? l10n.t("history.footnoteBars")
      : l10n.t("history.footnoteEnvelope");
  const range = rangeHours >= 72 && rangeHours % 24 === 0
    ? l10n.count("history.footnoteDays", rangeHours / 24)
    : l10n.count("history.footnoteHours", rangeHours);
  return `${lead} · ${l10n.t("history.footnoteCount", { count: series.readingsInRange, range })}`;
}

function spanRect(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
): { x: number; width: number } | null {
  const span = clampInterval(start, end, rangeStart, rangeEnd);
  if (!span) return null;
  const x = timeX(span.from, rangeStart, rangeEnd);
  const width = timeX(span.to, rangeStart, rangeEnd) - x;
  if (width <= 0) return null;
  return { x, width };
}

function EnvelopeLayer({
  series,
  mode,
  rangeStart,
  rangeEnd,
  plotWidth,
  now,
}: {
  series: EnvelopeSeries;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  plotWidth: number;
  now: number;
}) {
  const pxPerUnit = plotWidth / VIEWBOX_WIDTH;
  return (
    <g>
      {series.unknownRuns.map((run) => {
        const box = spanRect(run.start, run.end, rangeStart, rangeEnd);
        if (!box) return null;
        return (
          <rect
            key={`unknown-${run.start}`}
            className="history-chart__unknown"
            x={box.x}
            y={PLOT_TOP}
            width={box.width}
            height={PLOT_BOTTOM - PLOT_TOP}
          />
        );
      })}
      {series.idleSpans.filter((span) => span.kind === "unknown").map((span) => {
        const box = spanRect(span.start, span.end, rangeStart, rangeEnd);
        if (!box) return null;
        return (
          <rect
            key={`idle-unknown-${span.start}`}
            className="history-chart__unknown"
            x={box.x}
            y={PLOT_TOP}
            width={box.width}
            height={PLOT_BOTTOM - PLOT_TOP}
          />
        );
      })}
      {series.idleSpans.filter((span) => span.kind === "idle").map((span) => {
        const box = spanRect(span.start, span.end, rangeStart, rangeEnd);
        if (!box) return null;
        return (
          <line
            key={`idle-${span.start}`}
            className="history-chart__idle"
            x1={box.x}
            x2={box.x + box.width}
            y1={shownY(100, mode)}
            y2={shownY(100, mode)}
          />
        );
      })}
      {series.spans.map((window, index) => {
        const previous = series.spans[index - 1];
        const reset = previous && previous.kind === "observed" && previous.tailTrusted && window.kind === "observed";
        return (
          <g key={window.id}>
            {reset ? (
              <line
                className="history-chart__reset"
                x1={timeX(window.start, rangeStart, rangeEnd)}
                x2={timeX(window.start, rangeStart, rangeEnd)}
                y1={shownY(previous.values.at(-1) ?? 0, mode)}
                y2={shownY(100, mode)}
              />
            ) : null}
            {window.bands.map((band, bandIndex) => {
              const d = band.open
                ? openStub(band, mode, rangeStart, rangeEnd, pxPerUnit)
                : bandPath(band, mode, rangeStart, rangeEnd);
              if (!d) return null;
              return (
                <path
                  key={`${window.id}-band-${bandIndex}`}
                  className={band.event ? "history-chart__event" : band.open ? "history-chart__open" : "history-chart__band"}
                  d={d}
                />
              );
            })}
            <ReadingMarks window={window} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} pxPerUnit={pxPerUnit} now={now} />
          </g>
        );
      })}
      {series.events.map((event) => (
        <line
          key={`event-${event.at}`}
          className="history-chart__limit"
          x1={timeX(event.at, rangeStart, rangeEnd)}
          x2={timeX(event.at, rangeStart, rangeEnd)}
          y1={PLOT_TOP}
          y2={PLOT_BOTTOM}
        />
      ))}
      {series.trend.fit ? null : series.trend.points.map((point) => (
        <circle
          key={`end-${point.at}`}
          className="history-chart__end"
          cx={timeX(point.at, rangeStart, rangeEnd)}
          cy={shownY(100 - point.used, mode)}
          r="3.5"
        />
      ))}
    </g>
  );
}

function openStub(
  band: EnvelopeBand,
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
  pxPerUnit: number,
): string | null {
  const span = clampInterval(band.from, band.to, rangeStart, rangeEnd);
  if (!span) return null;
  const x1 = timeX(span.from, rangeStart, rangeEnd);
  const x2 = timeX(span.to, rangeStart, rangeEnd);
  const maxUnits = OPEN_STUB_PX / Math.max(pxPerUnit, 0.01);
  const end = x1 + Math.min(Math.abs(x2 - x1), maxUnits) * Math.sign(x2 - x1 || 1);
  const y = shownY(band.upper, mode);
  return `M ${x1.toFixed(2)} ${y.toFixed(2)} L ${end.toFixed(2)} ${y.toFixed(2)}`;
}

function ReadingMarks({
  window,
  mode,
  rangeStart,
  rangeEnd,
  pxPerUnit,
  now,
}: {
  window: WindowSpan;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  pxPerUnit: number;
  now: number;
}) {
  const marks: React.ReactNode[] = [];
  let run: { x: number; y: number }[] = [];
  const flush = (): void => {
    if (run.length >= 2) {
      const d = run.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
      marks.push(<path key={`run-${run[0]!.x}`} className="history-chart__line" d={d} />);
    }
    run = [];
  };
  window.readings.forEach((reading, index) => {
    if (reading.observedAt < rangeStart || reading.observedAt > rangeEnd) return;
    const x = timeX(reading.observedAt, rangeStart, rangeEnd);
    const y = shownY(window.values[index] ?? reading.left, mode);
    const previous = run.at(-1);
    const previousReading = window.readings[index - 1];
    const interval = expectedIntervalMs(now, reading.observedAt);
    const timeGap = previousReading !== undefined && reading.observedAt - previousReading.observedAt > interval * 2;
    const apart = previous !== undefined && (Math.abs(x - previous.x) * pxPerUnit > DOT_JOIN_PX || timeGap);
    if (apart) {
      if (run.length === 1) {
        marks.push(
          <circle key={`dot-${run[0]!.x}`} className="history-chart__marker" cx={run[0]!.x} cy={run[0]!.y} r="2.4" />,
        );
      }
      flush();
    }
    run.push({ x, y });
  });
  if (run.length === 1) {
    marks.push(
      <circle key={`dot-${run[0]!.x}`} className="history-chart__marker" cx={run[0]!.x} cy={run[0]!.y} r="2.4" />,
    );
  }
  flush();
  return <g>{marks}</g>;
}

function BarsLayer({
  series,
  mode,
  rangeStart,
  rangeEnd,
}: {
  series: EnvelopeSeries;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
}) {
  return (
    <g>
      {series.unknownRuns.map((run) => {
        const box = spanRect(run.start, run.end, rangeStart, rangeEnd);
        if (!box) return null;
        return (
          <rect
            key={`unknown-${run.start}`}
            className="history-chart__unknown"
            x={box.x}
            y={PLOT_TOP}
            width={box.width}
            height={PLOT_BOTTOM - PLOT_TOP}
          />
        );
      })}
      {series.idleSpans.filter((span) => span.kind === "unknown").map((span) => {
        const box = spanRect(span.start, span.end, rangeStart, rangeEnd);
        if (!box) return null;
        return (
          <rect
            key={`idle-unknown-${span.start}`}
            className="history-chart__unknown"
            x={box.x}
            y={PLOT_TOP}
            width={box.width}
            height={PLOT_BOTTOM - PLOT_TOP}
          />
        );
      })}
      {series.spans.map((window) => {
        const bar = windowBar(window);
        if (!bar) return null;
        const box = spanRect(window.start, window.end, rangeStart, rangeEnd);
        if (!box) return null;
        const { x, width } = box;
        const certainLeft = 100 - bar.certainUsed;
        const yCertain = mode === "used" ? shownY(certainLeft, mode) : shownY(100, mode);
        const height = Math.max(1, Math.abs(shownY(certainLeft, mode) - shownY(mode === "used" ? 100 : certainLeft, mode)));
        const hollow = bar.open ? Math.min(6, height) : 0;
        return (
          <g key={window.id} className={window.current ? "is-current" : undefined}>
            <rect
              className="history-chart__bar"
              x={x}
              y={mode === "used" ? yCertain : leftY(certainLeft)}
              width={width}
              height={height}
            />
            {hollow > 0 ? (
              <rect
                className="history-chart__hollow"
                x={x}
                y={mode === "used" ? yCertain - hollow : leftY(certainLeft)}
                width={width}
                height={hollow}
              />
            ) : null}
          </g>
        );
      })}
      {series.idleSpans.filter((span) => span.kind === "idle").map((span) => {
        const box = spanRect(span.start, span.end, rangeStart, rangeEnd);
        if (!box) return null;
        return (
          <line
            key={`idle-${span.start}`}
            className="history-chart__idle"
            x1={box.x}
            x2={box.x + box.width}
            y1={shownY(100, mode)}
            y2={shownY(100, mode)}
          />
        );
      })}
    </g>
  );
}

function DailyLayer({
  days,
  mode,
  rangeStart,
  rangeEnd,
}: {
  days: DayBucket[];
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
}) {
  return (
    <g>
      {days.map((bucket) => {
        const box = spanRect(bucket.start, bucket.end, rangeStart, rangeEnd);
        if (!box) return null;
        const { x, width } = box;
        const bar = bucket.window ? windowBar(bucket.window) : null;
        if (!bar) {
          return (
            <line
              key={bucket.start}
              className="history-chart__idle"
              x1={x}
              x2={x + width}
              y1={shownY(100, mode)}
              y2={shownY(100, mode)}
            />
          );
        }
        const certainLeft = 100 - bar.certainUsed;
        const y = mode === "used" ? shownY(certainLeft, mode) : leftY(100);
        const height = Math.abs(shownY(certainLeft, mode) - shownY(mode === "used" ? 100 : certainLeft, mode));
        return (
          <g key={bucket.start}>
            <rect
              className="history-chart__bar"
              x={x}
              y={mode === "used" ? y : leftY(certainLeft)}
              width={width}
              height={Math.max(1, height)}
            />
            {bar.open ? (
              <rect
                className="history-chart__hollow"
                x={x}
                y={mode === "used" ? y - Math.min(6, height) : leftY(certainLeft)}
                width={width}
                height={Math.min(6, Math.max(1, height))}
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function TrendLayer({
  series,
  mode,
  rangeStart,
  rangeEnd,
}: {
  series: EnvelopeSeries;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
}) {
  const fit = series.trend.fit;
  if (!fit || series.trend.points.length < 2) return null;
  const first = series.trend.points[0]!;
  const last = series.trend.points.at(-1)!;
  const y1 = shownY(100 - predictUsed(fit, first.at), mode);
  const y2 = shownY(100 - predictUsed(fit, last.at), mode);
  return (
    <line
      className="history-chart__trend"
      x1={timeX(first.at, rangeStart, rangeEnd)}
      x2={timeX(last.at, rangeStart, rangeEnd)}
      y1={y1}
      y2={y2}
    />
  );
}

function Legend({
  series,
  level,
  mode,
}: {
  series: EnvelopeSeries;
  level: DetailLevel;
  mode: DisplayMode;
}) {
  const noun = windowNoun(series.windowMs);
  const open = series.spans.some((window) => window.kind === "observed" && !window.tailTrusted);
  const unknown = level !== "daily" && (
    series.unknownRuns.length > 0 || series.idleSpans.some((span) => span.kind === "unknown")
  );
  const idle = series.idleSpans.some((span) => span.kind === "idle");
  const limit = series.events.some((event) => event.kind === "limit-change");
  const rebase = series.events.some((event) => event.kind === "rebase") || series.rebaseCapped;
  return (
    <ul className="history-chart__legend">
      {level === "envelope" ? (
        <>
          <li><span className="history-chart__legend-line" aria-hidden="true" />{l10n.t("history.legendReadings")}</li>
          <li><span className="history-chart__legend-band" aria-hidden="true" />{l10n.t("history.legendBand")}</li>
          {open ? <li><span className="history-chart__legend-open" aria-hidden="true" />{l10n.t("history.legendOpen")}</li> : null}
        </>
      ) : (
        <li>
          <span className="history-chart__legend-bar" aria-hidden="true" />
          {level === "daily"
            ? l10n.t("history.legendDaily", { noun })
            : l10n.t(mode === "used" ? "history.legendBarUsed" : "history.legendBarLeft", { noun })}
        </li>
      )}
      {open && level !== "envelope" ? (
        <li>{l10n.t(mode === "used" ? "history.legendHollowUsed" : "history.legendHollowLeft")}</li>
      ) : null}
      {unknown ? <li><span className="history-chart__legend-unknown" aria-hidden="true" />{l10n.t("history.legendUnknown")}</li> : null}
      {idle ? <li><span className="history-chart__legend-idle" aria-hidden="true" />{l10n.t("history.legendIdle")}</li> : null}
      {limit ? <li><span className="history-chart__legend-limit" aria-hidden="true" />{l10n.t("history.legendLimit")}</li> : null}
      {rebase ? <li><span className="history-chart__legend-limit" aria-hidden="true" />{l10n.t(series.rebaseCapped ? "history.legendRebaseCapped" : "history.legendRebase")}</li> : null}
      {series.trend.fit ? (
        <li><span className="history-chart__legend-trend" aria-hidden="true" />{l10n.t("history.legendTrend")}</li>
      ) : level === "envelope" ? (
        <li>
          <span className="history-chart__legend-end" aria-hidden="true" />
          {l10n.t("history.legendEnds")}
          <span className="history-chart__legend-note">
            {series.trend.reason === "span"
              ? l10n.t("history.trendNeedsSpan", { count: series.trend.points.length })
              : l10n.t("history.trendNeedsCount", { count: series.trend.points.length })}
          </span>
        </li>
      ) : (
        <li className="history-chart__legend-note">
          {series.trend.reason === "span"
            ? l10n.t("history.trendNeedsSpan", { count: series.trend.points.length })
            : l10n.t("history.trendNeedsCount", { count: series.trend.points.length })}
        </li>
      )}
    </ul>
  );
}
