import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";
import { formatDateTime } from "../../../i18n/format";
import { localizeDisplayModeCompact } from "../../../i18n/presentation";
import {
  buildEnvelopeSeries,
  dailyBuckets,
  detailLevel,
  meterPolicy,
  predictUsed,
  windowBar,
  DOT_JOIN_PX,
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

function timeX(at: number, rangeStart: number, rangeEnd: number): number {
  const duration = Math.max(1, rangeEnd - rangeStart);
  return PLOT_LEFT + ((at - rangeStart) / duration) * (PLOT_RIGHT - PLOT_LEFT);
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

function bandPath(band: EnvelopeBand, mode: DisplayMode, rangeStart: number, rangeEnd: number): string {
  const x1 = timeX(band.from, rangeStart, rangeEnd);
  const x2 = timeX(band.to, rangeStart, rangeEnd);
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
): string[] {
  const lines = [formatSpan(window.start, window.current ? window.end : window.end, window.current)];
  if (window.kind === "unknown") {
    lines.push(l10n.t("history.tooltipNoReadings"));
    lines.push(l10n.t("history.tooltipPossibleRange"));
    return lines;
  }
  lines.push(l10n.count("history.readingsInWindow", window.readings.length));
  if (window.values.length > 0) lines.push(observedRange(window.values, mode));
  const last = window.readings.at(-1);
  const endValue = window.values.at(-1);
  if (window.current && window.tailTrusted) {
    lines.push(l10n.t("history.tooltipLatestCurrent"));
  } else if (window.current && last) {
    lines.push(l10n.t("history.tooltipCurrentOpen", {
      duration: formatDuration(Math.max(0, window.end - last.observedAt)),
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
  const chartRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(360);
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

  const items = inspectItems(series, days, level, mode);
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

  const empty = readings === 0 && series.spans.every((window) => window.kind === "unknown") && series.idleSpans.length === 0;
  const tooltip = activeItem?.lines ?? null;
  const tooltipAnchor = activeItem
    ? tooltipPosition(activeItem.from, activeItem.to, rangeStart, rangeEnd, plotWidth)
    : null;

  return (
    <div className="history-chart" ref={chartRef}>
      {readings === 0 ? null : (
        <strong className="history-chart__latest">
          {l10n.t("history.latestPercent", {
            percent: latestShown(series, mode),
            mode: localizeDisplayModeCompact(mode),
          })}
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
            aria-describedby={summaryId}
            onKeyDown={onKeyDown}
          >
            <svg
              className="history-chart__svg"
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              aria-hidden="true"
            >
              {[100, 50, 0].map((guide) => {
                const y = leftY(guide);
                return (
                  <g key={guide} className="history-chart__guide">
                    <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
                    <text x="0" y={y + 3}>{String(guide)}</text>
                  </g>
                );
              })}
              {level === "envelope"
                ? <EnvelopeLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} plotWidth={plotWidth} activeId={active?.id} />
                : null}
              {level === "bars"
                ? <BarsLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} activeId={active?.id} />
                : null}
              {level === "daily"
                ? <DailyLayer days={days} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} activeId={active?.id} />
                : null}
              <TrendLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} />
            </svg>
            <div className="history-chart__hits">
              {items.map((item) => {
                const left = timeX(item.from, rangeStart, rangeEnd);
                const right = timeX(item.to, rangeStart, rangeEnd);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="history-chart__hit"
                    tabIndex={-1}
                    aria-label={item.lines[0]}
                    style={{
                      left: `${(Math.min(left, right) / VIEWBOX_WIDTH) * 100}%`,
                      width: `${(Math.max(2, Math.abs(right - left)) / VIEWBOX_WIDTH) * 100}%`,
                    }}
                    onMouseEnter={() => {
                      if (!pinned) setActive({ kind: item.kind, id: item.id });
                    }}
                    onMouseLeave={() => {
                      if (!pinned) setActive((current) => (current?.id === item.id ? null : current));
                    }}
                    onClick={() => {
                      setPinned(true);
                      setActive({ kind: item.kind, id: item.id });
                    }}
                  />
                );
              })}
            </div>
            {tooltip && tooltipAnchor ? (
              <div
                className="history-chart__tooltip"
                role="tooltip"
                style={{ left: tooltipAnchor.left, top: 4, maxWidth: TOOLTIP_MAX }}
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
      <p
        className="history-chart__range"
        aria-label={l10n.t("history.rangeAccessible", { start: formatRangeStart(resolvedRange) })}
      >
        <span>{formatRangeStart(resolvedRange)}</span>
        <span>{l10n.t("common.now")}</span>
      </p>
      <Legend series={series} level={level} mode={mode} />
      <p className="history-chart__footnote">{footnote(series, level, resolvedRange)}</p>
      <p className="visually-hidden" id={summaryId}>{summary}</p>
    </div>
  );
}

function latestShown(series: EnvelopeSeries, mode: DisplayMode): number {
  const observed = series.spans.filter((window) => window.kind === "observed");
  const last = observed.at(-1);
  const left = last?.values.at(-1) ?? 100;
  return percent(mode === "left" ? left : 100 - left);
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
    lines: windowTooltip(window, mode),
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

function tooltipPosition(
  from: number,
  to: number,
  rangeStart: number,
  rangeEnd: number,
  plotWidth: number,
): { left: number } {
  const mid = (timeX(from, rangeStart, rangeEnd) + timeX(to, rangeStart, rangeEnd)) / 2;
  const center = (mid / VIEWBOX_WIDTH) * plotWidth;
  const left = Math.min(Math.max(0, center - TOOLTIP_MAX / 2), Math.max(0, plotWidth - TOOLTIP_MAX));
  return { left };
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

function EnvelopeLayer({
  series,
  mode,
  rangeStart,
  rangeEnd,
  plotWidth,
  activeId,
}: {
  series: EnvelopeSeries;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  plotWidth: number;
  activeId?: string;
}) {
  const pxPerUnit = plotWidth / VIEWBOX_WIDTH;
  return (
    <g>
      {series.unknownRuns.map((run) => (
        <rect
          key={`unknown-${run.start}`}
          className="history-chart__unknown"
          x={timeX(run.start, rangeStart, rangeEnd)}
          y={PLOT_TOP}
          width={Math.max(1, timeX(run.end, rangeStart, rangeEnd) - timeX(run.start, rangeStart, rangeEnd))}
          height={PLOT_BOTTOM - PLOT_TOP}
        />
      ))}
      {series.idleSpans.filter((span) => span.kind === "unknown").map((span) => (
        <rect
          key={`idle-unknown-${span.start}`}
          className="history-chart__unknown"
          x={timeX(span.end, rangeStart, rangeEnd)}
          y={PLOT_TOP}
          width={Math.max(1, timeX(span.start, rangeStart, rangeEnd) - timeX(span.end, rangeStart, rangeEnd))}
          height={PLOT_BOTTOM - PLOT_TOP}
        />
      ))}
      {series.idleSpans.filter((span) => span.kind === "idle").map((span) => (
        <line
          key={`idle-${span.start}`}
          className="history-chart__idle"
          x1={timeX(span.end, rangeStart, rangeEnd)}
          x2={timeX(span.start, rangeStart, rangeEnd)}
          y1={shownY(100, mode)}
          y2={shownY(100, mode)}
        />
      ))}
      {series.spans.map((window, index) => {
        const previous = series.spans[index - 1];
        const reset = previous && previous.kind === "observed" && previous.tailTrusted && window.kind === "observed";
        return (
          <g key={window.id} className={activeId === window.id ? "is-active" : undefined}>
            {reset ? (
              <line
                className="history-chart__reset"
                x1={timeX(window.start, rangeStart, rangeEnd)}
                x2={timeX(window.start, rangeStart, rangeEnd)}
                y1={shownY(previous.values.at(-1) ?? 0, mode)}
                y2={shownY(100, mode)}
              />
            ) : null}
            {window.bands.map((band, bandIndex) => (
              <path
                key={`${window.id}-band-${bandIndex}`}
                className={band.event ? "history-chart__event" : band.open ? "history-chart__open" : "history-chart__band"}
                d={band.open ? openStub(band, mode, rangeStart, rangeEnd, pxPerUnit) : bandPath(band, mode, rangeStart, rangeEnd)}
              />
            ))}
            <ReadingMarks window={window} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} pxPerUnit={pxPerUnit} />
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
): string {
  const x1 = timeX(band.from, rangeStart, rangeEnd);
  const x2 = timeX(band.to, rangeStart, rangeEnd);
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
}: {
  window: WindowSpan;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  pxPerUnit: number;
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
    const x = timeX(reading.observedAt, rangeStart, rangeEnd);
    const y = shownY(window.values[index] ?? reading.left, mode);
    const previous = run.at(-1);
    const apart = previous ? Math.abs(x - previous.x) * pxPerUnit > DOT_JOIN_PX : false;
    if (apart) flush();
    run.push({ x, y });
    if (apart || index === window.readings.length - 1 && (run.length < 2)) {
      marks.push(<circle key={`dot-${reading.observedAt}`} className="history-chart__marker" cx={x} cy={y} r="2.4" />);
    }
  });
  flush();
  return <g>{marks}</g>;
}

function BarsLayer({
  series,
  mode,
  rangeStart,
  rangeEnd,
  activeId,
}: {
  series: EnvelopeSeries;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  activeId?: string;
}) {
  return (
    <g>
      {series.unknownRuns.map((run) => (
        <rect
          key={`unknown-${run.start}`}
          className="history-chart__unknown"
          x={timeX(run.start, rangeStart, rangeEnd)}
          y={PLOT_TOP}
          width={Math.max(1, timeX(run.end, rangeStart, rangeEnd) - timeX(run.start, rangeStart, rangeEnd))}
          height={PLOT_BOTTOM - PLOT_TOP}
        />
      ))}
      {series.spans.map((window) => {
        const bar = windowBar(window);
        if (!bar) return null;
        const x = timeX(window.start, rangeStart, rangeEnd);
        const width = Math.max(1, timeX(window.end, rangeStart, rangeEnd) - x);
        const certainLeft = 100 - bar.certainUsed;
        const yCertain = mode === "used" ? shownY(certainLeft, mode) : shownY(100, mode);
        const height = Math.max(1, Math.abs(shownY(certainLeft, mode) - shownY(mode === "used" ? 100 : certainLeft, mode)));
        const hollow = bar.open ? Math.min(6, height) : 0;
        return (
          <g key={window.id} className={window.current ? "is-current" : undefined}>
            <rect
              className={`history-chart__bar${activeId === window.id ? " is-active" : ""}`}
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
      {series.idleSpans.filter((span) => span.kind === "idle").map((span) => (
        <line
          key={`idle-${span.start}`}
          className="history-chart__idle"
          x1={timeX(span.end, rangeStart, rangeEnd)}
          x2={timeX(span.start, rangeStart, rangeEnd)}
          y1={shownY(100, mode)}
          y2={shownY(100, mode)}
        />
      ))}
    </g>
  );
}

function DailyLayer({
  days,
  mode,
  rangeStart,
  rangeEnd,
  activeId,
}: {
  days: DayBucket[];
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  activeId?: string;
}) {
  return (
    <g>
      {days.map((bucket) => {
        const x = timeX(bucket.start, rangeStart, rangeEnd);
        const width = Math.max(1, timeX(bucket.end, rangeStart, rangeEnd) - x);
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
              className={`history-chart__bar${activeId === `day-${bucket.start}` ? " is-active" : ""}`}
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
  const unknown = series.unknownRuns.length > 0 || series.idleSpans.some((span) => span.kind === "unknown");
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
