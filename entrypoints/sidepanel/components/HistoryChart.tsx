import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";
import { formatDateTime } from "../../../i18n/format";
import { localizeDisplayModeCompact } from "../../../i18n/presentation";
import {
  buildChartModel,
  paceLine,
  wholePercent,
  MIN_BAR_PX,
  type ChartBar,
  type ChartGap,
  type ChartIdle,
  type ChartModel,
  type ChartRun,
  type ChartWindow,
  type DisplayMode,
  type QuotaMetric,
  type UsageHistoryObservation,
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
const VIEWBOX_HEIGHT = 124;
const PLOT_LEFT = 8;
const PLOT_RIGHT = 312;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 98;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

interface Focus {
  id: string;
  title: string;
  lines: string[];
  /** Guide x, when the readout is a moment rather than a whole span. */
  x?: number;
  y?: number;
  from: number;
  to: number;
}

function timeX(at: number, start: number, end: number): number {
  const span = Math.max(1, end - start);
  const clamped = Math.min(end, Math.max(start, at));
  return PLOT_LEFT + ((clamped - start) / span) * (PLOT_RIGHT - PLOT_LEFT);
}

function valueY(used: number, mode: DisplayMode): number {
  const shown = mode === "used" ? used : 100 - used;
  return PLOT_BOTTOM - (Math.min(100, Math.max(0, shown)) / 100) * PLOT_HEIGHT;
}

function percentText(used: number, mode: DisplayMode): string {
  const shown = mode === "used" ? used : 100 - used;
  return `${wholePercent(shown)}%`;
}

function durationText(ms: number): string {
  const hour = 60 * 60 * 1_000;
  const day = 24 * hour;
  if (ms < hour) return l10n.count("history.durationMinutes", Math.max(1, Math.round(ms / 60_000)));
  if (ms < 2 * day) return l10n.count("history.durationHours", Math.round(ms / hour));
  const days = ms / day;
  const count = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return l10n.count("history.durationDays", count);
}

function windowTitle(window: ChartWindow): string {
  if (window.current) return l10n.t("history.windowCurrent", { when: formatDateTime(window.end) });
  return l10n.t("history.windowSpan", { start: formatDateTime(window.start), end: formatDateTime(window.end) });
}

function describeWindow(window: ChartWindow, mode: DisplayMode): Focus {
  const last = window.values.at(-1) ?? 0;
  const end = window.current
    ? l10n.t("history.readNow", { value: percentText(last, mode) })
    : window.tailKnown
      ? l10n.t("history.readEnded", { value: percentText(last, mode) })
      : l10n.t("history.readOpen", { value: percentText(last, mode) });
  return {
    id: window.id,
    title: windowTitle(window),
    lines: [
      windowTitle(window),
      l10n.t(mode === "used" ? "history.readPeak" : "history.readLowest", { value: percentText(window.peak, mode) }),
      l10n.count("history.readingsInWindow", window.readings.length),
      end,
    ],
    from: window.start,
    to: window.end,
  };
}

/** What the line says at `at`: a reading, a hold, or the gap between two readings. */
function describeAt(model: ChartModel, at: number, mode: DisplayMode): Focus | null {
  const hour = 60 * 60 * 1_000;
  const tolerance = (8 / Math.max(0.001, model.pxPerHour)) * hour;
  const window = model.drawnWindows.find((item) => item.start <= at && item.end >= at)
    ?? model.drawnWindows.find((item) => item.start - tolerance <= at && item.end + tolerance >= at);
  if (!window) {
    const idle = model.idle.find((span) => span.start <= at && span.end >= at);
    if (idle) return describeIdle(idle, mode);
    const gap = model.gaps.find((span) => span.start <= at && span.end >= at);
    if (gap) return describeGap(gap);
    return null;
  }
  let best = 0;
  window.readings.forEach((reading, index) => {
    if (Math.abs(reading.observedAt - at) < Math.abs(window.readings[best]!.observedAt - at)) best = index;
  });
  const nearest = window.readings[best]!;
  if (Math.abs(nearest.observedAt - at) <= tolerance) {
    return {
      id: `${window.id}-reading-${best}`,
      title: formatDateTime(nearest.observedAt),
      lines: [formatDateTime(nearest.observedAt), percentText(window.values[best]!, mode), windowTitle(window)],
      x: timeX(nearest.observedAt, model.rangeStart, model.rangeEnd),
      y: valueY(window.values[best]!, mode),
      from: nearest.observedAt,
      to: nearest.observedAt,
    };
  }
  const first = window.readings[0]!;
  const last = window.readings[window.readings.length - 1]!;
  const lastUsed = window.values[window.values.length - 1]!;
  if (at < first.observedAt) {
    return {
      id: `${window.id}-head`,
      title: formatDateTime(at),
      lines: [
        formatDateTime(at),
        l10n.t("history.readBetween", { low: percentText(0, mode), high: percentText(window.values[0]!, mode) }),
        l10n.t("history.readSinceReset", { duration: durationText(first.observedAt - window.start) }),
        windowTitle(window),
      ],
      x: timeX(at, model.rangeStart, model.rangeEnd),
      y: valueY(window.values[0]! * ((at - window.start) / Math.max(1, first.observedAt - window.start)), mode),
      from: at,
      to: at,
    };
  }
  if (at > last.observedAt) {
    return {
      id: `${window.id}-hold`,
      title: formatDateTime(at),
      lines: window.tailKnown
        ? [formatDateTime(at), percentText(lastUsed, mode), windowTitle(window)]
        : [
            formatDateTime(at),
            l10n.t(mode === "used" ? "history.readAtLeast" : "history.readAtMost", { value: percentText(lastUsed, mode) }),
            l10n.t("history.readNoSince", { when: formatDateTime(last.observedAt) }),
            windowTitle(window),
          ],
      x: timeX(at, model.rangeStart, model.rangeEnd),
      y: valueY(lastUsed, mode),
      from: at,
      to: at,
    };
  }
  const index = Math.max(1, window.readings.findIndex((reading) => reading.observedAt > at));
  const left = window.readings[index - 1]!;
  const right = window.readings[index]!;
  const leftUsed = window.values[index - 1]!;
  const rightUsed = window.values[index]!;
  const gap = right.observedAt - left.observedAt;
  const lines = [
    formatDateTime(at),
    leftUsed === rightUsed
      ? percentText(leftUsed, mode)
      : l10n.t("history.readBetween", { low: percentText(leftUsed, mode), high: percentText(rightUsed, mode) }),
  ];
  if (gap > 2 * hour) lines.push(l10n.t("history.readNoFor", { duration: durationText(gap) }));
  lines.push(windowTitle(window));
  const fraction = gap > 0 ? (at - left.observedAt) / gap : 0;
  return {
    id: `${window.id}-span-${index}`,
    title: formatDateTime(at),
    lines,
    x: timeX(at, model.rangeStart, model.rangeEnd),
    y: valueY(leftUsed + (rightUsed - leftUsed) * fraction, mode),
    from: at,
    to: at,
  };
}

function describeIdle(span: ChartIdle, mode: DisplayMode): Focus {
  const title = span.reason === "no-usage"
    ? l10n.t("history.idleNoUsage")
    : l10n.t("history.spanIdle");
  const lines = [title, `${formatDateTime(span.start)} – ${formatDateTime(span.end)}`];
  if (span.reason === "no-usage" && span.lastReadingAt !== undefined) {
    lines.push(l10n.t("history.idleLast", { value: percentText(0, mode), when: formatDateTime(span.lastReadingAt) }));
  }
  return { id: `idle-${span.start}`, title, lines, from: span.start, to: span.end };
}

function describeGap(gap: ChartGap): Focus {
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

function describeBar(bar: ChartBar, mode: DisplayMode): Focus {
  const peak = percentText(bar.peak, mode);
  if (bar.perDay && bar.busiest) {
    return {
      id: bar.id,
      title: formatDateTime((bar.start + bar.end) / 2),
      lines: [
        formatDateTime((bar.start + bar.end) / 2),
        l10n.t("history.barBusiest", { value: peak }),
        l10n.count("history.barWindows", bar.drawnWindows),
      ],
      from: bar.start,
      to: bar.end,
    };
  }
  const lines = [
    bar.busiest ? windowTitle(bar.busiest) : formatDateTime(bar.start),
    l10n.t(mode === "used" ? "history.readPeak" : "history.readLowest", { value: peak }),
  ];
  if (!bar.tailKnown) lines.push(l10n.t("history.tooltipOpenEnd"));
  return { id: bar.id, title: lines[0]!, lines, from: bar.start, to: bar.end };
}

function focusAt(model: ChartModel, at: number, mode: DisplayMode): Focus | null {
  if (model.tier === "line") return describeAt(model, at, mode);
  const bar = model.bars.find((item) => item.start <= at && item.end >= at);
  if (bar) return describeBar(bar, mode);
  const idle = model.idle.find((span) => span.start <= at && span.end >= at);
  if (idle) return describeIdle(idle, mode);
  const gap = model.gaps.find((span) => span.start <= at && span.end >= at);
  return gap ? describeGap(gap) : null;
}

function keyboardStops(model: ChartModel, mode: DisplayMode): Focus[] {
  if (model.tier !== "line") return model.bars.map((bar) => describeBar(bar, mode));
  const readings = model.drawnWindows.flatMap((window, windowIndex) =>
    window.readings.map((reading, index) => ({
      id: `${window.id}-${windowIndex}-reading-${index}`,
      title: formatDateTime(reading.observedAt),
      lines: [
        formatDateTime(reading.observedAt),
        percentText(window.values[index]!, mode),
        windowTitle(window),
      ],
      x: timeX(reading.observedAt, model.rangeStart, model.rangeEnd),
      y: valueY(window.values[index]!, mode),
      from: reading.observedAt,
      to: reading.observedAt,
    })),
  );
  return [...readings, ...model.idle.map((span) => describeIdle(span, mode))]
    .sort((left, right) => left.from - right.from);
}

function runPath(run: ChartRun, model: ChartModel, mode: DisplayMode): { fill: string; groups: { style: string; d: string }[] } {
  const points = run.points.map((point) => ({
    x: timeX(point.at, model.rangeStart, model.rangeEnd),
    y: valueY(point.used, mode),
  }));
  const fill = `M${points[0]!.x} ${PLOT_BOTTOM} ${points.map((point) => `L${point.x} ${point.y}`).join(" ")} L${points.at(-1)!.x} ${PLOT_BOTTOM}Z`;
  const groups: { style: string; d: string }[] = [];
  run.styles.forEach((style, index) => {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) return;
    const last = groups.at(-1);
    const piece = `L${to.x} ${to.y}`;
    if (last && last.style === style) last.d += ` ${piece}`;
    else groups.push({ style, d: `M${from.x} ${from.y} ${piece}` });
  });
  return { fill, groups };
}

function barGeometry(bar: ChartBar, model: ChartModel): { x: number; width: number; depth: number } | null {
  const x1 = timeX(bar.start, model.rangeStart, model.rangeEnd);
  const slot = timeX(bar.end, model.rangeStart, model.rangeEnd) - x1;
  if (slot <= 0 || bar.peak <= 0) return null;
  const gap = slot >= 8 ? 2 : 1;
  const width = Math.max(1.5, slot - gap);
  const raw = (bar.peak / 100) * PLOT_HEIGHT;
  return { x: x1 + (slot - width) / 2, width, depth: Math.max(MIN_BAR_PX, raw) };
}

function dateTicks(model: ChartModel): { at: number; label: string }[] {
  const hour = 60 * 60 * 1_000;
  const range = model.rangeEnd - model.rangeStart;
  const stepDays = range <= 48 * hour ? 1 : range <= 7 * 24 * hour ? 2 : 7;
  const ticks: { at: number; label: string }[] = [];
  const first = new Date(model.rangeStart);
  let at = new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime();
  if (at < model.rangeStart) at += 24 * hour;
  let index = 0;
  for (; at < model.rangeEnd; at += 24 * hour, index += 1) {
    if (index % stepDays !== 0) continue;
    const x = timeX(at, model.rangeStart, model.rangeEnd);
    if (x < PLOT_LEFT + 22 || x > PLOT_RIGHT - 36) continue;
    ticks.push({
      at,
      label: new Intl.DateTimeFormat(l10n.localeTag(), { month: "short", day: "numeric" }).format(new Date(at)),
    });
  }
  return ticks;
}

function translatePace(pace: ReturnType<typeof paceLine>): string {
  const when = pace.detail.when === undefined ? "" : formatDateTime(Number(pace.detail.when));
  const out = pace.detail.out === undefined ? "" : formatDateTime(Number(pace.detail.out));
  const percent = pace.detail.percent ?? 0;
  switch (pace.detailKey) {
    case "history.paceResets": return l10n.t("history.paceResets", { when });
    case "history.paceNone": return l10n.t("history.paceNone", { when });
    case "history.paceLimit": return l10n.t("history.paceLimit", { when });
    case "history.paceFor": return l10n.t("history.paceFor", { percent, when });
    case "history.paceLeft": return l10n.t("history.paceLeft", { percent, when });
    case "history.paceRunOut": return l10n.t("history.paceRunOut", { out, when });
    default: return l10n.t("history.paceNoWindow");
  }
}

function currentReading(history: UsageHistoryObservation[], metricId: string, now: number): {
  used: number;
  start: number | undefined;
  resetsAt: number | undefined;
} | undefined {
  const readings = history.flatMap((observation) =>
    observation.metrics
      .filter((sample) => sample.type === "quota" && sample.metricId === metricId && observation.observedAt <= now)
      .map((sample) => ({ at: observation.observedAt, sample })),
  );
  const latest = readings.at(-1);
  if (!latest || latest.sample.type !== "quota") return undefined;
  const resetsAt = latest.sample.cycle?.resetsAt;
  const duration = latest.sample.cycle?.durationMs;
  const startedAt = latest.sample.cycle?.startedAt;
  if (resetsAt !== undefined && resetsAt < now) return undefined;
  const start = startedAt ?? (resetsAt !== undefined && duration !== undefined ? resetsAt - duration : undefined);
  return { used: latest.sample.usedRatio * 100, start, resetsAt };
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
  const infoId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(360);
  const [hover, setHover] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const [keyIndex, setKeyIndex] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedMetricId, setSelectedMetricId] = useState(() => metrics[0]?.id ?? "");

  useEffect(() => {
    if (!metrics.some((metric) => metric.id === selectedMetricId)) setSelectedMetricId(metrics[0]?.id ?? "");
  }, [selectedMetricId, metrics]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = (): void => setPlotWidth(element.clientWidth || 360);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const metric = metrics.find((item) => item.id === selectedMetricId) ?? metrics[0];
  const hours = rangeHours ?? 30 * 24;
  const rangeEnd = now;
  const rangeStart = now - hours * 60 * 60 * 1_000;

  const model = useMemo(() => {
    if (!metric) return undefined;
    const omitted = history.filter((observation) =>
      !observation.metrics.some((sample) => sample.type === "quota" && sample.metricId === metric.id),
    );
    return buildChartModel({
      history,
      metricId: metric.id,
      ...(providerKind ? { providerKind } : {}),
      now,
      rangeStart,
      rangeEnd,
      widthPx: Math.max(1, plotWidth),
      omittedObservations: omitted,
    });
  }, [history, metric, providerKind, now, rangeStart, rangeEnd, plotWidth]);

  const stops = useMemo(() => (model ? keyboardStops(model, mode) : []), [model, mode]);
  const current = metric ? currentReading(history, metric.id, now) : undefined;
  const pace = paceLine({
    currentUsed: current?.used,
    windowStart: current?.start,
    resetsAt: current?.resetsAt,
    now,
    mode,
  });

  if (!metric || !model) return null;

  const active = hover ?? pinned ?? (keyIndex !== null ? stops[keyIndex] ?? null : null);
  const empty = model.readingsInRange === 0 && model.drawnWindows.length === 0;

  function atClientX(clientX: number): Focus | null {
    const canvas = chartRef.current?.querySelector(".history-chart__canvas");
    if (!(canvas instanceof Element)) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const viewX = ((clientX - bounds.left) / bounds.width) * VIEWBOX_WIDTH;
    if (viewX < PLOT_LEFT || viewX > PLOT_RIGHT) return null;
    const at = rangeStart + ((viewX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT)) * (rangeEnd - rangeStart);
    return focusAt(model!, at, mode);
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

  const note = model.readingsInRange === 0
    ? l10n.t("history.noteNone", { range: l10n.count("history.footnoteHours", hours) })
    : model.readingsInRange < 5
      ? l10n.t("history.rangeSparse", { range: l10n.count("history.footnoteHours", hours), count: model.readingsInRange })
      : null;

  const info = [
    model.tier === "line" ? l10n.t("history.infoLine") : l10n.t("history.infoBars"),
    model.hasEstimated ? l10n.t("history.infoDashed") : "",
    model.idle.length > 0 ? l10n.t("history.infoIdle") : "",
    model.gaps.length > 0 ? l10n.t("history.infoGaps") : "",
    model.resets.length > 0 ? l10n.t("history.infoResets") : "",
    l10n.t("history.infoStored", { count: model.readingsInRange }),
  ].filter((item) => item.length > 0);

  const tooltipLeft = active?.x !== undefined
    ? Math.max(0, Math.min(VIEWBOX_WIDTH - 150, active.x - 75))
    : Math.max(0, Math.min(VIEWBOX_WIDTH - 150, (timeX(active?.from ?? rangeStart, rangeStart, rangeEnd) + timeX(active?.to ?? rangeEnd, rangeStart, rangeEnd)) / 2 - 75));

  return (
    <div className="history-chart" ref={chartRef}>
      <div className="history-chart__head">
        <p className={pace.warn ? "history-chart__latest is-warn" : "history-chart__latest"}>
          {l10n.t("history.latestPercent", { percent: wholePercent(pace.shown), mode: localizeDisplayModeCompact(mode) })}
        </p>
        <button
          type="button"
          className="history-chart__info"
          aria-expanded={infoOpen}
          aria-controls={infoId}
          aria-label={l10n.t("history.infoLabel", { label: metric.label })}
          onClick={() => setInfoOpen((open) => !open)}
        >
          i
        </button>
      </div>
      <p className={pace.warn ? "history-chart__status is-warn" : "history-chart__status"}>
        {translatePace(pace)}
      </p>
      {infoOpen ? (
        <ul id={infoId} className="history-chart__info-list">
          {info.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {empty ? (
        <p className="history-chart__empty">{l10n.t("history.empty")}</p>
      ) : (
        <div className="history-chart__plot">
          <div
            className="history-chart__canvas"
            role="group"
            tabIndex={0}
            aria-roledescription={l10n.t("history.chartRole")}
            aria-label={l10n.t("history.chartName", { provider: providerName, label: metric.label })}
            aria-describedby={summaryId}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
              else if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
              else if (event.key === "Home") { event.preventDefault(); setKeyIndex(0); }
              else if (event.key === "End") { event.preventDefault(); setKeyIndex(stops.length - 1); }
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
              <text className="history-chart__tick" x={PLOT_RIGHT} y={12} textAnchor="end">100%</text>
              <line className="history-chart__axis" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />
              {model.tier === "line"
                ? model.runs.map((run) => {
                    const drawn = runPath(run, model, mode);
                    return (
                      <g key={run.id}>
                        <path className="history-chart__area" d={drawn.fill} />
                        {drawn.groups.map((group, index) => (
                          <path
                            key={index}
                            className={group.style === "known" ? "history-chart__line" : "history-chart__line is-dashed"}
                            d={group.d}
                            strokeDasharray={group.style === "known" ? undefined : "3 3"}
                          />
                        ))}
                        {run.points.map((point, index) => point.dot ? (
                          <circle key={index} className="history-chart__dot" cx={timeX(point.at, rangeStart, rangeEnd)} cy={valueY(point.used, mode)} r="2" />
                        ) : null)}
                      </g>
                    );
                  })
                : null}
              {model.tier !== "line" && mode === "used"
                ? model.bars.map((bar) => {
                    const shape = barGeometry(bar, model);
                    if (!shape) return null;
                    return <rect key={bar.id} className="history-chart__bar" x={shape.x} y={PLOT_BOTTOM - shape.depth} width={shape.width} height={shape.depth} rx="1.5" />;
                  })
                : null}
              {model.tier !== "line" && mode === "left" ? (
                <path
                  className="history-chart__area"
                  d={[
                    `M${PLOT_LEFT} ${PLOT_BOTTOM} L${PLOT_LEFT} ${valueY(0, mode)}`,
                    ...model.bars.flatMap((bar) => {
                      const shape = barGeometry(bar, model);
                      if (!shape) return [];
                      const bottom = Math.min(PLOT_BOTTOM, valueY(0, mode) + shape.depth);
                      return [`L${shape.x} ${valueY(0, mode)} L${shape.x} ${bottom} L${shape.x + shape.width} ${bottom} L${shape.x + shape.width} ${valueY(0, mode)}`];
                    }),
                    `L${PLOT_RIGHT} ${valueY(0, mode)} L${PLOT_RIGHT} ${PLOT_BOTTOM}Z`,
                  ].join(" ")}
                />
              ) : null}
              {model.idle.map((span) => (
                <line
                  key={`idle-${span.start}`}
                  className="history-chart__idle"
                  data-idle={span.reason}
                  x1={timeX(span.start, rangeStart, rangeEnd)}
                  x2={timeX(span.end, rangeStart, rangeEnd)}
                  y1={valueY(0, mode)}
                  y2={valueY(0, mode)}
                  strokeDasharray="2 3"
                />
              ))}
              {model.gaps.map((gap) => (
                <line
                  key={`gap-${gap.start}`}
                  className="history-chart__gap"
                  x1={timeX(gap.start, rangeStart, rangeEnd)}
                  x2={timeX(gap.end, rangeStart, rangeEnd)}
                  y1={PLOT_BOTTOM + 3}
                  y2={PLOT_BOTTOM + 3}
                  strokeDasharray="2 2"
                />
              ))}
              {dateTicks(model).map((tick) => (
                <text key={tick.at} className="history-chart__tick" x={timeX(tick.at, rangeStart, rangeEnd)} y={116} textAnchor="middle">
                  {tick.label}
                </text>
              ))}
              {model.resets.map((at) => (
                <line key={`reset-${at}`} className="history-chart__reset" x1={timeX(at, rangeStart, rangeEnd)} x2={timeX(at, rangeStart, rangeEnd)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} />
              ))}
              <text className="history-chart__tick" x={PLOT_RIGHT} y={116} textAnchor="end">{l10n.t("common.now")}</text>
              {active?.x !== undefined ? (
                <g>
                  <line className="history-chart__guide-active" x1={active.x} x2={active.x} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
                  {active.y !== undefined ? <circle className="history-chart__dot-active" cx={active.x} cy={active.y} r="3.5" /> : null}
                </g>
              ) : null}
              {active && active.x === undefined ? (
                <rect
                  className="history-chart__highlight"
                  x={timeX(active.from, rangeStart, rangeEnd)}
                  y={PLOT_TOP}
                  width={Math.max(1, timeX(active.to, rangeStart, rangeEnd) - timeX(active.from, rangeStart, rangeEnd))}
                  height={PLOT_HEIGHT}
                />
              ) : null}
            </svg>
            {note && !active ? <p className="history-chart__note">{note}</p> : null}
            {active ? (
              <div className="history-chart__tooltip" role="tooltip" style={{ left: `${(tooltipLeft / VIEWBOX_WIDTH) * 100}%`, top: active.y !== undefined && active.y < 58 ? 62 : 2 }}>
                {active.lines.map((line) => <p key={line}>{line}</p>)}
              </div>
            ) : null}
          </div>
        </div>
      )}
      <p className="visually-hidden" id={summaryId}>{l10n.t("history.summaryKeys")}</p>
    </div>
  );
}

/**
 * x spans of the painted data, in viewBox units. Marks shorter than 2 screen
 * px are dropped so a hairline tick is not treated as coverage.
 */
export function paintedXSpans(container: ParentNode, plotWidth: number): { from: number; to: number }[] {
  const pxPerUnit = Math.max(plotWidth, 1) / VIEWBOX_WIDTH;
  const minScreenPx = 2;
  const spans: { from: number; to: number }[] = [];
  container.querySelectorAll("svg path, svg rect, svg line").forEach((node) => {
    const element = node as SVGElement;
    if (element.classList.contains("history-chart__axis")) return;
    if (element.classList.contains("history-chart__reset")) return;
    if (element.classList.contains("history-chart__guide-active")) return;
    if (element.classList.contains("history-chart__highlight")) return;
    if (node.tagName.toLowerCase() === "path") {
      const numbers = [...(element.getAttribute("d") ?? "").matchAll(/-?\d+(?:\.\d+)?/g)].map((item) => Number(item[0]));
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
      if ((maxY - minY) * pxPerUnit < minScreenPx && (maxX - minX) * pxPerUnit < minScreenPx) return;
      if (maxX - minX > 0.2) spans.push({ from: minX, to: maxX });
      return;
    }
    if (node.tagName.toLowerCase() === "line") {
      const x1 = Number(element.getAttribute("x1"));
      const x2 = Number(element.getAttribute("x2"));
      if (Math.abs(x2 - x1) * pxPerUnit < minScreenPx) return;
      spans.push({ from: Math.min(x1, x2), to: Math.max(x1, x2) });
      return;
    }
    const height = Number(element.getAttribute("height"));
    const width = Number(element.getAttribute("width"));
    if (height * pxPerUnit < minScreenPx || width * pxPerUnit < minScreenPx) return;
    const x = Number(element.getAttribute("x"));
    spans.push({ from: x, to: x + width });
  });
  return spans;
}
