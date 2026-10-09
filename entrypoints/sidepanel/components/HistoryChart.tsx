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
const TOOLTIP_MAX = 180;
/** Screen pixels of the idle baseline. ViewBox units shrink with the panel. */
const IDLE_BASELINE_PX = 8;

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
  readingAt?: number,
): string[] {
  // A reading on the line is one time and one value. The window span, the
  // reading count, and the open-end note made the box cover half the plot.
  if (readingAt !== undefined) {
    const index = window.readings.findIndex((reading) => reading.observedAt === readingAt);
    const left = window.values[index];
    const lines = [formatDateTime(readingAt)];
    if (left !== undefined) lines.push(observedRange([left], mode));
    const last = window.readings.at(-1);
    if (!window.current && !window.tailTrusted && last && last.observedAt === readingAt) {
      lines.push(l10n.t("history.tooltipOpenEnd", {
        duration: formatDuration(Math.max(0, window.end - last.observedAt)),
      }));
    }
    return lines;
  }
  const lines = [formatSpan(window.start, window.end, window.current)];
  if (window.kind === "unknown") {
    lines.push(l10n.t("history.tooltipNoReadings"));
    return lines;
  }
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

function spanTooltip(span: IdleSpan, _mode: DisplayMode): string[] {
  if (span.kind === "unknown") return [l10n.t("history.spanUnknownTitle")];
  return [l10n.t("history.spanIdle")];
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
  const focusedBeforePress = useRef(false);
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
    if (!element) return undefined;
    const update = (): void => {
      const plot = element.querySelector(".history-chart__plot");
      setPlotWidth((plot ?? element).clientWidth || 360);
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
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
    ? detailLevel(series.windowMs || 60 * 60 * 1_000, rangeEnd - rangeStart, Math.max(1, plotWidth))
    : "bars";
  const days = useMemo(
    () => (series && level === "daily"
      ? dailyBuckets(series.spans, rangeStart, rangeEnd, now)
      : []),
    [series, level, rangeStart, rangeEnd, now],
  );

  if (!selectedMetric || !series) return null;

  const items = inspectItems(series, days, level, mode, now, rangeStart, rangeEnd, Math.max(plotWidth, 1));
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
    if (index < 0) {
      const item = step > 0 ? items[0] : items.at(-1);
      if (item) setActive({ kind: item.kind, id: item.id });
      return;
    }
    const here = items[index]?.guide?.x;
    let next = index;
    const forward = step > 0;
    let cursor = index + step;
    const limit = items.length;
    while (forward ? cursor < limit : cursor >= 0) {
      next = cursor;
      const guide = items[cursor]?.guide?.x;
      if (here === undefined || guide === undefined || Math.abs(guide - here) > 0.5) break;
      cursor += step;
    }
    const item = items[next];
    if (!item) return;
    setActive({ kind: item.kind, id: item.id });
  }

  function itemAtClientX(clientX: number): Inspectable | undefined {
    const canvas = chartRef.current?.querySelector(".history-chart__canvas");
    if (!(canvas instanceof Element)) return undefined;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0) return undefined;
    const viewX = ((clientX - bounds.left) / bounds.width) * VIEWBOX_WIDTH;
    if (viewX < PLOT_LEFT || viewX > PLOT_RIGHT) return undefined;
    const hits = items.filter((item) => {
      const box = item.hit;
      if (!box) return false;
      const starts = viewX >= box.x;
      const ends = viewX <= box.x + box.width;
      return starts && ends;
    });
    if (hits.length === 0) return undefined;
    // A line target owns the paper out to the midpoint of its neighbors, so
    // the nearest reading wins. A span only wins where no reading covers it.
    const readings = hits.filter((item) => item.guide);
    const pool = readings.length > 0 ? readings : hits;
    return pool.sort((left, right) => {
      const leftAt = left.guide?.x ?? left.hit!.x + left.hit!.width / 2;
      const rightAt = right.guide?.x ?? right.hit!.x + right.hit!.width / 2;
      return Math.abs(leftAt - viewX) - Math.abs(rightAt - viewX);
    })[0];
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
      if (first) setActive({ kind: first.kind, id: first.id });
    } else if (event.key === "End") {
      event.preventDefault();
      const last = items.at(-1);
      if (last) setActive({ kind: last.kind, id: last.id });
    } else if (event.key === "Escape") {
      setActive(null);
      setPinned(false);
    }
  }

  const empty = readings === 0;
  const tooltip = activeItem?.lines ?? null;
  const tooltipAnchor = activeItem
    ? tooltipPosition(activeItem, rangeStart, rangeEnd, plotWidth)
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
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) return;
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
                {level === "envelope" ? (
                  <EnvelopeLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} plotWidth={plotWidth} now={now} />
                ) : null}
                {level === "bars" ? (
                  <BarsLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} plotWidth={plotWidth} />
                ) : null}
                {level === "daily" ? (
                  <DailyLayer days={days} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} plotWidth={plotWidth} />
                ) : null}
                <TrendLayer series={series} mode={mode} rangeStart={rangeStart} rangeEnd={rangeEnd} />
                {activeItem ? (
                  <Highlight
                    item={activeItem}
                    mode={mode}
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    pinned={pinned}
                  />
                ) : null}
              </g>
            </svg>
            <div className="history-chart__hits">
              {items.map((item) => {
                if (!item.hit) return null;
                const pinnedHere = pinned && active?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={pinnedHere ? "history-chart__hit is-pinned" : "history-chart__hit"}
                    tabIndex={-1}
                    aria-label={item.lines[0]}
                    aria-pressed={pinnedHere}
                    style={{
                      left: `${(item.hit.x / VIEWBOX_WIDTH) * 100}%`,
                      width: `${(item.hit.width / VIEWBOX_WIDTH) * 100}%`,
                    }}
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      const canvas = chartRef.current?.querySelector<HTMLElement>(".history-chart__canvas");
                      // The press that first focuses the chart must not also pin.
                      focusedBeforePress.current = document.activeElement === canvas;
                      canvas?.focus();
                    }}
                    onMouseDown={(event) => {
                      // The hit is the top element, so a click would focus the
                      // button. Keep focus on the chart, where the arrow keys are.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      // A press that only just focused the chart does not pin
                      // or select. The next click on the focused chart does.
                      if (!focusedBeforePress.current) return;
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
                style={{
                  left: tooltipAnchor.left,
                  top: tooltipAnchor.top,
                  maxWidth: tooltipAnchor.maxWidth,
                }}
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
  /** Screen box of this target. Missing when the target paints nothing. */
  hit?: { x: number; width: number };
  /** A reading on a line: guide and dot, not a shaded window. */
  guide?: { x: number; y: number };
}

function hitBox(
  from: number,
  to: number,
  rangeStart: number,
  rangeEnd: number,
): { x: number; width: number } | undefined {
  const box = spanRect(from, to, rangeStart, rangeEnd);
  if (!box || box.width < 0.4) return undefined;
  return box;
}

/**
 * Targets are what the chart paints. A window drawn as a line is one target
 * per reading (a guide and a dot). A bar, an outline, or an idle stretch stays
 * one target. A region with no mark is not a target.
 */
function inspectItems(
  series: EnvelopeSeries,
  days: DayBucket[],
  level: DetailLevel,
  mode: DisplayMode,
  now: number,
  rangeStart: number,
  rangeEnd: number,
  plotWidth: number,
): Inspectable[] {
  if (level === "daily") {
    return days.flatMap((bucket) => {
      const hit = hitBox(bucket.start, bucket.end, rangeStart, rangeEnd);
      if (!hit) return [];
      return [{
        kind: "day" as const,
        id: `day-${bucket.start}`,
        from: bucket.start,
        to: bucket.end,
        lines: dayTooltip(bucket, mode, series.policy),
        hit,
      }];
    });
  }
  const lineWindows = level === "envelope";
  const windowItems = series.spans.flatMap((window) => {
    if (lineWindows && window.kind === "observed" && window.readings.length > 0) {
      return readingTargets(window, mode, now, rangeStart, rangeEnd, plotWidth);
    }
    const hit = hitBox(window.start, window.end, rangeStart, rangeEnd);
    if (!hit) return [];
    return [{
      kind: "window" as const,
      id: window.id,
      from: window.start,
      to: window.end,
      lines: windowTooltip(window, mode, now),
      hit,
    }];
  });
  const gaps = [...series.idleSpans, ...series.unknownRuns].flatMap((span, index) => {
    const from = Math.min(span.start, span.end);
    const to = Math.max(span.start, span.end);
    const hit = hitBox(from, to, rangeStart, rangeEnd);
    if (!hit) return [];
    return [{
      kind: "span" as const,
      id: `span-${span.start}-${span.end}-${index}`,
      from,
      to,
      lines: spanTooltip(span, mode),
      hit,
    }];
  });
  return [...windowItems, ...gaps].sort((left, right) => left.from - right.from || left.to - right.to);
}

/** One keyboard/hover step per reading of a window drawn as a line. */
function readingTargets(
  window: WindowSpan,
  mode: DisplayMode,
  now: number,
  rangeStart: number,
  rangeEnd: number,
  plotWidth: number,
): Inspectable[] {
  // About 8 px between steps. The guide snaps to the last reading of a
  // closer run, and the last reading of the window is always its own step.
  const pxPerUnit = plotWidth / VIEWBOX_WIDTH;
  const minGap = 8 / Math.max(pxPerUnit, 0.01);
  const visible = window.readings.filter((reading) => {
    const afterStart = reading.observedAt >= rangeStart;
    const beforeEnd = reading.observedAt <= rangeEnd;
    return afterStart && beforeEnd;
  });
  const kept: { at: number; x: number; y: number }[] = [];
  visible.forEach((reading, index) => {
    const x = timeX(reading.observedAt, rangeStart, rangeEnd);
    const y = shownY(window.values[window.readings.indexOf(reading)] ?? reading.left, mode);
    const previous = kept.at(-1);
    if (previous && x - previous.x < minGap) return;
    kept.push({ at: reading.observedAt, x, y });
  });
  return kept.map((point, index) => {
    const before = kept[index - 1]?.x ?? point.x;
    const after = kept[index + 1]?.x ?? point.x;
    // The first reading owns the empty paper to its left, so a hover there
    // still names a reading. The guide itself stays on the reading.
    const rawLeft = index === 0 ? PLOT_LEFT : (before + point.x) / 2;
    const rawRight = index === kept.length - 1 ? PLOT_RIGHT : (point.x + after) / 2;
    const left = Math.max(PLOT_LEFT, Math.min(rawLeft, PLOT_RIGHT - 0.8));
    const right = Math.min(PLOT_RIGHT, Math.max(rawRight, left + 0.8));
    return {
      kind: "window" as const,
      id: `${window.id}-reading-${point.at}`,
      from: point.at,
      to: point.at,
      lines: windowTooltip(window, mode, now, point.at),
      hit: { x: left, width: Math.max(0.4, right - left) },
      guide: { x: point.x, y: point.y },
    };
  });
}

function Highlight({
  item,
  mode,
  rangeStart,
  rangeEnd,
  pinned,
}: {
  item: Inspectable;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  pinned: boolean;
}) {
  if (item.guide) {
    const y = shownY(0, mode);
    return (
      <g className={pinned ? "is-pinned" : undefined}>
        <line
          className="history-chart__guide-active"
          x1={item.guide.x}
          x2={item.guide.x}
          y1={PLOT_TOP}
          y2={PLOT_BOTTOM}
        />
        <circle className="history-chart__dot-active" cx={item.guide.x} cy={item.guide.y} r="3.2" />
      </g>
    );
  }
  const span = clampInterval(item.from, item.to, rangeStart, rangeEnd);
  if (!span) return null;
  const left = timeX(span.from, rangeStart, rangeEnd);
  const right = timeX(span.to, rangeStart, rangeEnd);
  return (
    <rect
      className={pinned ? "history-chart__highlight is-pinned" : "history-chart__highlight"}
      x={left}
      y={PLOT_TOP}
      width={Math.max(1, right - left)}
      height={PLOT_BOTTOM - PLOT_TOP}
    />
  );
}

function tooltipPosition(
  item: Inspectable,
  rangeStart: number,
  rangeEnd: number,
  plotWidth: number,
): { left: number; top: number; maxWidth: number } {
  // Sit on the opposite side of the dot so the box does not cover it. A span
  // has no dot; its midpoint is the pointer the span names.
  const anchorX = item.guide?.x ?? (() => {
    const span = clampInterval(item.from, item.to, rangeStart, rangeEnd) ?? { from: item.from, to: item.to };
    return (timeX(span.from, rangeStart, rangeEnd) + timeX(span.to, rangeStart, rangeEnd)) / 2;
  })();
  const anchorPx = (anchorX / VIEWBOX_WIDTH) * plotWidth;
  const gap = 12;
  const onRight = anchorPx > plotWidth / 2;
  const available = onRight ? anchorPx : plotWidth - anchorPx;
  const maxWidth = Math.min(TOOLTIP_MAX, Math.max(48, available - gap));
  const left = onRight ? anchorPx - gap - maxWidth : anchorPx + gap;
  const top = item.guide
    ? Math.max(4, (item.guide.y / VIEWBOX_HEIGHT) * ((plotWidth * VIEWBOX_HEIGHT) / VIEWBOX_WIDTH) - 28)
    : 4;
  return { left: Math.max(0, left), top, maxWidth };
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

/**
 * Viewbox x intervals that a mark actually paints. An untrusted tail, open
 * or closed, is the short dotted stub plus the possible-range band through
 * the reset. A trusted tail is the band that holds the last value. Window
 * bounds are not coverage.
 */
/**
 * ViewBox x intervals of marks the chart paints. A rect shorter than two
 * screen pixels is a hairline, not a baseline, so it does not count. Paths
 * count from their own coordinates. The span's time interval does not.
 */
export function paintedXSpans(container: ParentNode, plotWidth: number): { from: number; to: number }[] {
  const pxPerUnit = Math.max(plotWidth, 1) / VIEWBOX_WIDTH;
  const minScreenPx = 2;
  const spans: { from: number; to: number }[] = [];
  container.querySelectorAll("svg rect, svg path").forEach((node) => {
    if (node.parentElement?.tagName === "clipPath") return;
    if (node.tagName === "path") {
      const numbers = [...(node.getAttribute("d") ?? "").matchAll(/-?\d+(?:\.\d+)?/g)].map((item) => Number(item[0]));
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        minX = Math.min(minX, numbers[index]!);
        maxX = Math.max(maxX, numbers[index]!);
        minY = Math.min(minY, numbers[index + 1]!);
        maxY = Math.max(maxY, numbers[index + 1]!);
      }
      if (!Number.isFinite(minX)) return;
      const tall = (maxY - minY) * pxPerUnit >= minScreenPx;
      const wide = (maxX - minX) * pxPerUnit >= minScreenPx;
      if (!tall && !wide) return;
      if (maxX - minX > 0.2) spans.push({ from: minX, to: maxX });
      return;
    }
    const height = Number(node.getAttribute("height"));
    const width = Number(node.getAttribute("width"));
    if (height * pxPerUnit < minScreenPx || width * pxPerUnit < minScreenPx) return;
    const x = Number(node.getAttribute("x"));
    spans.push({ from: x, to: x + width });
  });
  return spans;
}

export function drawnXSpans(options: {
  series: EnvelopeSeries;
  rangeStart: number;
  rangeEnd: number;
  plotWidth: number;
  level: DetailLevel;
}): { from: number; to: number }[] {
  const { series, rangeStart, rangeEnd, plotWidth, level } = options;
  const pxPerUnit = plotWidth / VIEWBOX_WIDTH;
  const spans: { from: number; to: number }[] = [];
  const pushBox = (start: number, end: number): void => {
    const box = spanRect(start, end, rangeStart, rangeEnd);
    if (box) spans.push({ from: box.x, to: box.x + box.width });
  };
  for (const run of series.unknownRuns) pushBox(run.start, run.end);
  // Only spans that paint a mark. An idle span paints the baseline band
  // (or the dashed column when it is long and unproven).
  for (const span of series.idleSpans) {
    if (span.kind === "unknown") {
      pushBox(span.start, span.end);
      continue;
    }
    const box = spanRect(span.start, span.end, rangeStart, rangeEnd);
    if (!box || box.width < 0.4) continue;
    spans.push({ from: box.x, to: box.x + box.width });
  }
  if (level === "envelope") {
    for (const window of series.spans) {
      if (window.kind !== "observed") continue;
      for (const band of window.bands) {
        if (band.open) {
          const drawn = openStubSpan(band, rangeStart, rangeEnd, pxPerUnit);
          if (drawn) spans.push(drawn);
          const rest = openTailBox(band, rangeStart, rangeEnd, pxPerUnit);
          if (rest) spans.push(rest);
        } else {
          const span = clampInterval(band.from, band.to, rangeStart, rangeEnd);
          if (!span) continue;
          spans.push({
            from: timeX(span.from, rangeStart, rangeEnd),
            to: timeX(span.to, rangeStart, rangeEnd),
          });
        }
      }
      for (const reading of window.readings) {
        if (reading.observedAt < rangeStart || reading.observedAt > rangeEnd) continue;
        const x = timeX(reading.observedAt, rangeStart, rangeEnd);
        spans.push({ from: x - 2.4, to: x + 2.4 });
      }
    }
    return spans;
  }
  for (const window of series.spans) {
    if (window.kind === "observed") pushBox(window.start, window.end);
  }
  return spans;
}

/** Idle baseline tall enough to see. ViewBox units would shrink to a hairline. */
function IdleBaseline({
  box,
  plotWidth,
}: {
  box: { x: number; width: number };
  plotWidth: number;
}) {
  const pxPerUnit = Math.max(plotWidth, 1) / VIEWBOX_WIDTH;
  const height = IDLE_BASELINE_PX / pxPerUnit;
  return (
    <rect
      className="history-chart__idle"
      x={box.x}
      y={Math.max(PLOT_TOP, PLOT_BOTTOM - height)}
      width={box.width}
      height={Math.min(height, PLOT_BOTTOM - PLOT_TOP)}
    />
  );
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
        // Every idle span is the neutral baseline, including a gap shorter
        // than one window. A long first-use stretch with no proof is the
        // dashed "no readings" column instead.
        if (!(span.end - span.start < series.windowMs) && span.proofReadings === 0) {
          return (
            <rect
              key={`idle-${span.start}`}
              className="history-chart__unknown"
              x={box.x}
              y={PLOT_TOP}
              width={box.width}
              height={PLOT_BOTTOM - PLOT_TOP}
            />
          );
        }
        return (
          <IdleBaseline key={`idle-${span.start}`} box={box} plotWidth={plotWidth} />
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
              // The dotted stub is at most 10 px. The rest of an open tail,
              // including a closed window's, is the possible-range band.
              // Gating that band on the current window left a blank column
              // between the stub and the reset circle.
              const rest = band.open
                ? openTailBand(band, mode, rangeStart, rangeEnd, pxPerUnit)
                : null;
              if (!d && !rest) return null;
              return (
                <g key={`${window.id}-band-${bandIndex}`}>
                  {rest ? <path className="history-chart__band" d={rest} /> : null}
                  {d ? (
                    <path
                      className={band.event ? "history-chart__event" : band.open ? "history-chart__open" : "history-chart__band"}
                      d={d}
                    />
                  ) : null}
                </g>
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
  const drawn = openStubSpan(band, rangeStart, rangeEnd, pxPerUnit);
  if (!drawn) return null;
  const y = shownY(band.upper, mode);
  return `M ${drawn.from.toFixed(2)} ${y.toFixed(2)} L ${drawn.to.toFixed(2)} ${y.toFixed(2)}`;
}

/** The dotted stub, at most OPEN_STUB_PX of screen, in viewbox units. */
function openStubSpan(
  band: EnvelopeBand,
  rangeStart: number,
  rangeEnd: number,
  pxPerUnit: number,
): { from: number; to: number } | null {
  const span = clampInterval(band.from, band.to, rangeStart, rangeEnd);
  if (!span) return null;
  const x1 = timeX(span.from, rangeStart, rangeEnd);
  const x2 = timeX(span.to, rangeStart, rangeEnd);
  const maxUnits = OPEN_STUB_PX / Math.max(pxPerUnit, 0.01);
  const end = x1 + Math.min(Math.abs(x2 - x1), maxUnits) * Math.sign(x2 - x1 || 1);
  if (Math.abs(end - x1) <= 0.05) return null;
  return { from: Math.min(x1, end), to: Math.max(x1, end) };
}

/**
 * The open tail past the stub, as a possible-range band. The stub stays the
 * dotted mark; the band fills the column the stub does not cover.
 */
function openTailBand(
  band: EnvelopeBand,
  mode: DisplayMode,
  rangeStart: number,
  rangeEnd: number,
  pxPerUnit: number,
): string | null {
  const box = openTailBox(band, rangeStart, rangeEnd, pxPerUnit);
  if (!box) return null;
  const yUpper = shownY(band.upper, mode);
  const yLower = shownY(band.lower, mode);
  const top = Math.min(yUpper, yLower);
  const bottom = Math.max(yUpper, yLower);
  return `M ${box.from.toFixed(2)} ${top.toFixed(2)} L ${box.to.toFixed(2)} ${top.toFixed(2)} L ${box.to.toFixed(2)} ${bottom.toFixed(2)} L ${box.from.toFixed(2)} ${bottom.toFixed(2)} Z`;
}

/** Viewbox x of the whole open tail. The stub is drawn over its first 10 px. */
function openTailBox(
  band: EnvelopeBand,
  rangeStart: number,
  rangeEnd: number,
  _pxPerUnit: number,
): { from: number; to: number } | null {
  const span = clampInterval(band.from, band.to, rangeStart, rangeEnd);
  if (!span) return null;
  const from = timeX(span.from, rangeStart, rangeEnd);
  const to = timeX(span.to, rangeStart, rangeEnd);
  if (Math.abs(to - from) <= 0.4) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
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
  plotWidth,
}: {
  series: EnvelopeSeries;
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  plotWidth: number;
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
          <IdleBaseline key={`idle-${span.start}`} box={box} plotWidth={plotWidth} />
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
  plotWidth,
}: {
  days: DayBucket[];
  mode: DisplayMode;
  rangeStart: number;
  rangeEnd: number;
  plotWidth: number;
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
            <IdleBaseline key={bucket.start} box={{ x, width }} plotWidth={plotWidth} />
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
