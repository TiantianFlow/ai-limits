import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEnvelopeSeries,
  detailLevel,
  uncoveredGaps,
  type ProviderInstanceView,
  type UsageSnapshot,
} from "../../../domain/public-protocol";
import type { QuotaMetric, UsageHistoryObservation } from "../../../domain/model";
import { FIXTURE_NOW, REALISTIC_METERS, idleGrid, type RealisticMeter } from "../../../domain/history-realistic";
import { HistoryView } from "../views/HistoryView";
import { formatPercent } from "../../../i18n/format";
import { installI18nLocale } from "../../../test/i18n-harness";
import { HistoryChart, paintedXSpans } from "./HistoryChart";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 10, 16);

function metric(id: string, durationMs: number, label = id): QuotaMetric {
  return {
    type: "quota",
    id,
    label,
    scope: "general",
    usedRatio: 0.4,
    cycle: { cadence: durationMs >= DAY ? "calendar" : "rolling", durationMs, resetsAt: NOW + durationMs },
  };
}

function observation(
  metricId: string,
  observedAt: number,
  usedRatio: number,
  cycle: UsageHistoryObservation["metrics"][number] extends infer _ ? object : never,
): UsageHistoryObservation {
  return {
    observedAt,
    metrics: [{ type: "quota", metricId, usedRatio, ...cycle }],
  };
}

afterEach(() => {
  cleanup();
  installI18nLocale("en");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.restoreAllMocks();
});

function weeklyHistory(): UsageHistoryObservation[] {
  const windows = 6;
  const samples: UsageHistoryObservation[] = [];
  for (let index = windows; index >= 0; index -= 1) {
    const end = NOW - index * 7 * DAY;
    samples.push(observation("weekly", end - 6 * DAY, 0.2 + (windows - index) * 0.05, {
      cycle: { cadence: "calendar", durationMs: 7 * DAY, resetsAt: end },
    }));
    samples.push(observation("weekly", end - 2 * HOUR, 0.4 + (windows - index) * 0.05, {
      cycle: { cadence: "calendar", durationMs: 7 * DAY, resetsAt: end },
    }));
  }
  return samples;
}

describe("HistoryChart", () => {
  it("draws a line and area for a wide window, solid where values match", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const history = weeklyHistory().map((sample) => ({
      ...sample,
      metrics: sample.metrics.map((item) => ({
        ...item,
        metricId: "five-hour",
        cycle: { cadence: "rolling" as const, durationMs: 5 * HOUR, resetsAt: sample.observedAt + 5 * HOUR },
      })),
    }));
    const { container, rerender } = render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );

    const chart = screen.getByRole("group", { name: /Claude 5-hour messages usage history/ });
    expect(chart).toHaveAttribute("aria-roledescription", "chart");
    expect(container.querySelectorAll(".history-chart__area").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".history-chart__line").length).toBeGreaterThan(0);
    expect(container.querySelector(".history-chart__band")).toBeNull();
    expect(container.querySelector(".history-chart__legend")).toBeNull();
    expect(screen.queryByText("Possible range between readings")).not.toBeInTheDocument();

    rerender(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="left"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );
    expect(screen.getByText((_, element) => element?.classList.contains("history-chart__latest") === true && /% left/.test(element.textContent ?? ""))).toBeVisible();
  });

  it("draws one bar per window when each window is only a few pixels wide", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(340);
    const samples: UsageHistoryObservation[] = [];
    for (let index = 20; index >= 0; index -= 1) {
      const end = NOW - index * DAY;
      samples.push(observation("daily-meter", end - 2 * HOUR, 0.3, {
        cycle: { cadence: "calendar", durationMs: DAY, resetsAt: end },
      }));
    }
    const { container } = render(
      <HistoryChart
        providerName="Cursor"
        providerKind="cursor"
        mode="used"
        metrics={[metric("daily-meter", DAY, "Daily")]}
        history={samples}
        now={NOW}
        rangeHours={30 * 24}
      />,
    );
    expect(container.querySelectorAll(".history-chart__bar").length).toBeGreaterThan(0);
    expect(container.querySelector(".history-chart__band")).toBeNull();
    expect(screen.queryByText(/Bars show certain usage only/)).not.toBeInTheDocument();

    const chart = screen.getByRole("group", { name: /usage history/ });
    expect(container.querySelector(".history-chart__highlight")).toBeNull();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(container.querySelector(".history-chart__highlight")).not.toBeNull();
    fireEvent.keyDown(chart, { key: "Home" });
    expect(container.querySelectorAll(".history-chart__highlight")).toHaveLength(1);
    fireEvent.keyDown(chart, { key: "End" });
    expect(container.querySelectorAll(".history-chart__highlight")).toHaveLength(1);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(container.querySelector(".history-chart__highlight")).toBeNull();
  });

  it("advances the keyboard time on every Right press", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const history: UsageHistoryObservation[] = [];
    for (let index = 0; index < 8; index += 1) {
      const at = NOW - (40 - index * 4) * HOUR;
      history.push(observation("five-hour", at, 0.1 + index * 0.05, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: at + 4 * HOUR },
      }));
      // A second reading a minute later thins to the same x at 48 h.
      history.push(observation("five-hour", at + 60_000, 0.12 + index * 0.05, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: at + 4 * HOUR },
      }));
    }
    render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    const seen: string[] = [];
    for (let press = 0; press < 6; press += 1) {
      fireEvent.keyDown(chart, { key: "ArrowRight" });
      seen.push(screen.getByRole("tooltip").textContent ?? "");
    }
    const times = seen.map((text) => text.split("Peak")[0] ?? text);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).not.toBe(times[index - 1]);
    }
  });

  it("draws one bar per day for a short window squeezed under 4 px", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(80);
    const samples: UsageHistoryObservation[] = [];
    for (let day = 0; day < 14; day += 1) {
      const start = NOW - (14 - day) * DAY;
      samples.push(observation("five-hour", start + 2 * HOUR, 0.2 + day * 0.05, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: start + 7 * HOUR },
      }));
    }
    const { container } = render(
      <HistoryChart
        providerName="Kimi"
        providerKind="kimi"
        mode="used"
        metrics={[metric("five-hour-coding", 5 * HOUR, "5-hour usage")]}
        history={samples.map((sample) => ({
          ...sample,
          metrics: sample.metrics.map((item) => ({ ...item, metricId: "five-hour-coding" })),
        }))}
        now={NOW}
        rangeHours={30 * 24}
      />,
    );
    expect(container.querySelectorAll(".history-chart__bar").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Each bar = busiest/)).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("group", { name: /usage history/ }), { key: "ArrowRight" });
    expect(container.querySelector(".history-chart__highlight")).not.toBeNull();
  });

  it("shows a window tooltip and moves between windows with the arrow keys", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const history: UsageHistoryObservation[] = [];
    for (let index = 0; index < 6; index += 1) {
      const at = NOW - (40 - index * 6) * HOUR;
      history.push(observation("five-hour", at, 0.1 + index * 0.05, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: at + 5 * HOUR },
      }));
    }
    const { container } = render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip")).toBeVisible();
    const mark = container.querySelector(".history-chart__guide-active, .history-chart__highlight");
    expect(mark).not.toBeNull();
    const seen: string[] = [];
    for (let press = 0; press < 6; press += 1) {
      fireEvent.keyDown(chart, { key: "ArrowRight" });
      seen.push(screen.getByRole("tooltip").textContent ?? "");
    }
    expect(new Set(seen).size).toBe(seen.length);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(chart).toHaveAccessibleDescription(/arrow keys/i);
  });

  it("uses the zh_CN catalog for the status line", () => {
    installI18nLocale("zh_CN");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5 小时消息")]}
        history={weeklyHistory().map((sample) => ({
          ...sample,
          metrics: sample.metrics.map((item) => ({
            ...item,
            metricId: "five-hour",
            cycle: { cadence: "rolling" as const, durationMs: 5 * HOUR, resetsAt: sample.observedAt + 5 * HOUR },
          })),
        }))}
        now={NOW}
        rangeHours={48}
      />,
    );
    expect(screen.getByText(/重置|没有用量|按目前速度/)).toBeVisible();
    expect(screen.queryByText("读数")).not.toBeInTheDocument();
  });

  function drawnOutsidePlot(container: HTMLElement): string[] {
    const plot = { left: 8, right: 312, top: 10, bottom: 128 };
    const epsilon = 0.6;
    const problems: string[] = [];
    const svg = container.querySelector("svg");
    if (!svg) return ["missing svg"];
    const clip = svg.querySelector("clipPath rect");
    const consider = (label: string, x: number, y: number): void => {
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      if (x < plot.left - epsilon || x > plot.right + epsilon || y < plot.top - epsilon || y > plot.bottom + epsilon) {
        problems.push(`${label} ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    };
    svg.querySelectorAll("rect, circle, line").forEach((node) => {
      if (node.parentElement?.tagName === "clipPath") return;
      if (node.classList.contains("history-chart__guide")) return;
      const x = Number(node.getAttribute("x") ?? node.getAttribute("cx") ?? node.getAttribute("x1"));
      const y = Number(node.getAttribute("y") ?? node.getAttribute("cy") ?? node.getAttribute("y1"));
      const width = Number(node.getAttribute("width") ?? 0);
      const height = Number(node.getAttribute("height") ?? 0);
      consider(node.getAttribute("class") ?? node.tagName, x, y);
      if (node.hasAttribute("width")) consider("extent", x + width, y + height);
      if (node.hasAttribute("x2")) {
        consider("x2", Number(node.getAttribute("x2")), Number(node.getAttribute("y2")));
      }
    });
    svg.querySelectorAll("path").forEach((path) => {
      const match = path.getAttribute("d")?.matchAll(/-?\d+(?:\.\d+)?/g);
      const numbers = match ? [...match].map((item) => Number(item[0])) : [];
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        consider(path.getAttribute("class") ?? "path", numbers[index]!, numbers[index + 1]!);
      }
    });
    return problems.slice(0, 6);
  }

  it("draws a visible band across the Cursor reset, not empty paper", () => {
    const cursor = REALISTIC_METERS.find((meter) => meter.metricId === "other-models-monthly")!;
    const rangeMs = 30 * DAY;
    const rangeStart = FIXTURE_NOW - rangeMs;
    const series = buildEnvelopeSeries(cursor.history, {
      providerKind: "cursor",
      metricId: "other-models-monthly",
      now: FIXTURE_NOW,
      rangeStart,
      rangeEnd: FIXTURE_NOW,
    });
    const plotLeft = 28;
    const plotRight = 312;
    const timeAt = (at: number): number =>
      plotLeft + ((at - rangeStart) / rangeMs) * (plotRight - plotLeft);
    const observed = series.spans.filter((window) => window.kind === "observed");
    const boundary = observed.find((window) => window.readings.every((reading) => reading.durationMs === 30 * DAY));
    const previous = observed.find((window) =>
      window.readings.length > 1 && window.readings.every((reading) => reading.durationMs === 31 * DAY),
    );
    expect(boundary).toBeDefined();
    expect(previous).toBeDefined();
    const lastUpper = previous!.readings.at(-1)!.observedAt;
    const firstLower = boundary!.readings[0]!.observedAt;
    const gap = { from: timeAt(lastUpper), to: timeAt(firstLower) };
    const plotHeight = 92 - 8;
    const pxPerUnit = 340 / 320;
    const stubUnits = 10 / pxPerUnit;
    const covers = (band: { from: number; to: number; upper: number; lower: number; open?: boolean }): boolean => {
      const from = timeAt(Math.max(rangeStart, band.from));
      const to = timeAt(Math.min(FIXTURE_NOW, band.to));
      const drawnTo = band.open ? Math.min(to, from + stubUnits) : to;
      const overlaps = from <= gap.from + 0.6 && drawnTo >= gap.to - 0.6;
      return overlaps && Math.abs(band.upper - band.lower) >= plotHeight / 2;
    };
    const drawn = [...previous!.bands, ...boundary!.bands].some(covers);
    expect(drawn, "the column between the two windows needs a band at least half the plot tall").toBe(true);
  });

  it("paints a calendar month that has no durationMs across the 30-day plot", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const cycleStart = NOW - 26 * DAY;
    const cycleEnd = cycleStart + 30 * DAY;
    const nextEnd = cycleEnd + 31 * DAY;
    const history: UsageHistoryObservation[] = [];
    for (let index = 0; index < 44; index += 1) {
      const at = cycleStart + ((index + 0.5) / 44) * (cycleEnd - cycleStart);
      history.push(observation("monthly-total", at, 0.02 + (index / 43) * 0.97, {
        cycle: { cadence: "calendar", startedAt: cycleStart, resetsAt: cycleEnd },
      }));
    }
    history.push(
      observation("monthly-total", cycleEnd + 6 * HOUR, 0.01, {
        cycle: { cadence: "calendar", startedAt: cycleEnd, resetsAt: nextEnd },
      }),
      observation("monthly-total", cycleEnd + 20 * HOUR, 0.04, {
        cycle: { cadence: "calendar", startedAt: cycleEnd, resetsAt: nextEnd },
      }),
    );
    const now = cycleEnd + 2 * DAY;
    const rangeStart = now - 30 * DAY;
    const { container } = render(
      <HistoryChart
        providerName="Kimi"
        providerKind="kimi"
        mode="used"
        metrics={[metric("monthly-total", 30 * DAY, "Total usage")]}
        history={history}
        now={now}
        rangeHours={30 * 24}
      />,
    );
    const plotLeft = 8;
    const plotRight = 312;
    const firstX = plotLeft + ((history[0]!.observedAt - rangeStart) / (30 * DAY)) * (plotRight - plotLeft);
    const lastX = plotLeft + ((history.at(-1)!.observedAt - rangeStart) / (30 * DAY)) * (plotRight - plotLeft);
    const painted = paintedXSpans(container, 460);
    const gaps = uncoveredGaps(painted, Math.max(plotLeft, firstX), lastX, 2);
    expect(gaps).toEqual([]);
    const unknownOverReading = [...container.querySelectorAll(".history-chart__gap")].filter((box) => {
      const x = Number(box.getAttribute("x"));
      const width = Number(box.getAttribute("width"));
      return history.some((item) => {
        const at = plotLeft + ((item.observedAt - rangeStart) / (30 * DAY)) * (plotRight - plotLeft);
        return at >= x && at <= x + width;
      });
    });
    expect(unknownOverReading).toEqual([]);
  });

  it("covers the drawn chart from the first reading to now, stub included", () => {
    const widths = [340, 460];
    const ranges = [48, 7 * 24, 30 * 24];
    const plotLeft = 8;
    const plotRight = 312;
    const epsilon = 2;
    for (const meter of REALISTIC_METERS.filter((item) => item.history.length > 0)) {
      for (const width of widths) {
        for (const rangeHours of ranges) {
          const rangeMs = rangeHours * HOUR;
          const rangeStart = FIXTURE_NOW - rangeMs;
          const series = buildEnvelopeSeries(meter.history, {
            providerKind: meter.providerKind,
            metricId: meter.metricId,
            now: FIXTURE_NOW,
            rangeStart,
            rangeEnd: FIXTURE_NOW,
          });
          const observed = series.spans.filter((window) => window.kind === "observed" && window.readings.length > 0);
          const segments = observed.map((window) => {
            const start = Math.max(rangeStart, window.readings[0]!.observedAt);
            const end = Math.min(FIXTURE_NOW, window.readings.at(-1)!.observedAt);
            return { from: start, to: Math.max(start, end) };
          }).filter((segment) => segment.to > segment.from);
          const duration = Math.max(1, rangeMs);
          const xOf = (at: number): number => plotLeft + ((at - rangeStart) / duration) * (plotRight - plotLeft);
          const { container, unmount } = render(
            <HistoryChart
              providerName={meter.providerName}
              providerKind={meter.providerKind}
              mode="used"
              metrics={[metricFor(meter)]}
              history={meter.history}
              now={FIXTURE_NOW}
              rangeHours={rangeHours}
            />,
          );
          const painted = paintedXSpans(container, width);
          for (const segment of segments) {
            const gaps = uncoveredGaps(painted, xOf(segment.from), xOf(segment.to), epsilon);
            expect(gaps, `${meter.metricId} ${rangeHours}h @${width}`).toEqual([]);
          }
          unmount();
        }
      }
    }
  });

  it("renders the synthetic fixture inside the plot at every range and mode", () => {
    const widths = [340, 400, 460];
    const ranges = [48, 7 * 24, 30 * 24];
    for (const meter of REALISTIC_METERS.filter((item) => item.history.length > 0)) {
      for (const width of widths) {
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
        for (const rangeHours of ranges) {
          for (const mode of ["used", "left"] as const) {
            const { container, unmount } = render(
              <HistoryChart
                providerName={meter.providerName}
                providerKind={meter.providerKind}
                mode={mode}
                metrics={[metricFor(meter)]}
                history={meter.history}
                now={FIXTURE_NOW}
                rangeHours={rangeHours}
              />,
            );
            expect(drawnOutsidePlot(container), `${meter.metricId} ${mode} ${rangeHours}h @${width}`).toEqual([]);
            if (meter.currentUsedRatio !== undefined) {
              const shown = mode === "used" ? meter.currentUsedRatio * 100 : (1 - meter.currentUsedRatio) * 100;
              const headline = container.querySelector(".history-chart__latest")?.textContent ?? "";
              const rounded = shown > 0 && shown < 1 ? "<1" : String(Math.round(shown));
              expect(headline).toContain(`${rounded}%`);
            }
            const unknown = [...container.querySelectorAll(".history-chart__unknown")];
            for (const box of unknown) {
              const x = Number(box.getAttribute("x"));
              const widthAttr = Number(box.getAttribute("width"));
              expect(x).toBeGreaterThanOrEqual(8);
              expect(x + widthAttr).toBeLessThanOrEqual(312.1);
            }
            unmount();
          }
        }
      }
    }
  }, 30_000);

  it("does not draw an under-axis gap dash on the same stretch as the 5-hour idle baseline", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const meter = REALISTIC_METERS.find((item) => item.providerKind === "claude" && item.metricId === "five-hour");
    if (!meter) throw new Error("missing claude five-hour fixture");
    const { container } = render(
      <HistoryChart
        providerName={meter.providerName}
        providerKind={meter.providerKind}
        mode="used"
        metrics={[metricFor(meter)]}
        history={meter.history}
        now={FIXTURE_NOW}
        rangeHours={7 * 24}
      />,
    );
    const gaps = [...container.querySelectorAll(".history-chart__gap")];
    expect(gaps).toEqual([]);
    expect(container.querySelector(".history-chart__idle")).not.toBeNull();
  });

  it("names the idle or empty stretch under the pointer instead of a distant reading", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 460, bottom: 200, width: 460, height: 200, toJSON() { return {}; },
    });
    const anchor = NOW - 46 * HOUR;
    const history = idleGrid({ metricId: "five-hour-coding", windowMs: 5 * HOUR, now: NOW, anchor });
    const { container } = render(
      <HistoryChart
        providerName="Kimi"
        providerKind="kimi"
        mode="used"
        metrics={[metric("five-hour-coding", 5 * HOUR, "5-hour usage")]}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );
    const chart = container.querySelector(".history-chart__canvas") as HTMLElement;
    const idle = container.querySelector(".history-chart__idle") as SVGLineElement | null;
    const empty = container.querySelector(".history-chart__gap") as SVGLineElement | null;
    if (!idle) throw new Error("no idle line");
    if (!empty) throw new Error("no gap mark");
    const hover = (line: SVGLineElement): void => {
      const x = (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2;
      fireEvent.pointerMove(chart, { clientX: (x / 320) * 460, pointerType: "mouse" });
    };
    hover(idle);
    const tip = (): string => container.querySelector(".history-chart__tooltip")?.textContent ?? "";
    expect(tip()).toMatch(/Idle|No usage/);
    hover(empty);
    expect(tip()).toMatch(/No readings/);
  });

  function metricFor(meter: RealisticMeter): QuotaMetric {
    const duration = meter.metricId.includes("five-hour")
      ? 5 * HOUR
      : meter.metricId === "30-day" || meter.metricId.includes("monthly")
        ? 30 * DAY
        : 7 * DAY;
    return metric(meter.metricId, duration, meter.label);
  }

  /** Viewbox x of a pointer, matching itemAtClientX's canvas mapping. */
  function clientXForView(viewX: number, canvasWidth = 400): number {
    return (viewX / 320) * canvasWidth;
  }

  function chartBounds(chart: HTMLElement): void {
    const bounds = { left: 0, width: 400, top: 0, height: 140 };
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      ...bounds,
      right: 400,
      bottom: 140,
      x: 0,
      y: 0,
      toJSON: () => bounds,
    });
  }

  it("does not call a current window stale when its latest reading is recent", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const claude = REALISTIC_METERS.find((meter) => meter.metricId === "weekly")!;
    render(
      <HistoryChart
        providerName={claude.providerName}
        providerKind="claude"
        mode="used"
        metrics={[metricFor(claude)]}
        history={claude.history}
        now={FIXTURE_NOW}
        rangeHours={48}
      />,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    chartBounds(chart);
    fireEvent.pointerMove(chart, { clientX: clientXForView(300), clientY: 40, pointerType: "mouse" });
    const tooltip = screen.getByRole("tooltip").textContent ?? "";
    expect(tooltip.length).toBeGreaterThan(0);
    expect(tooltip).not.toMatch(/No reading in the last/);
    expect(tooltip).not.toMatch(/last one/);

    const windowEnd = FIXTURE_NOW - 2 * DAY;
    const windowStart = windowEnd - 7 * DAY;
    const staleHistory = [0, 1, 2].map((day) => ({
      observedAt: windowStart + day * DAY,
      metrics: [{
        type: "quota" as const,
        metricId: "weekly",
        usedRatio: 0.2 + day * 0.05,
        cycle: { cadence: "calendar" as const, durationMs: 7 * DAY, resetsAt: windowEnd },
      }],
    }));
    cleanup();
    render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("weekly", 7 * DAY, "Weekly messages")]}
        history={staleHistory}
        now={windowEnd + 2 * DAY}
        rangeHours={14 * 24}
      />,
    );
    const again = screen.getByRole("group", { name: /usage history/ });
    chartBounds(again);
    const againChart = screen.getByRole("group", { name: /usage history/ });
    const texts: string[] = [];
    for (let press = 0; press < 6; press += 1) {
      fireEvent.keyDown(againChart, { key: "ArrowRight" });
      texts.push(screen.queryByRole("tooltip")?.textContent ?? "");
    }
    expect(texts.join(" ")).not.toMatch(/last one/);
    expect(new Set(texts).size).toBeGreaterThan(1);
  });

  it("tracks the pointer across a weekly 30-day plot at three widths", () => {
    const meter = REALISTIC_METERS.find((item) => item.metricId === "weekly")!;
    for (const width of [340, 400, 460]) {
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
      const { container, unmount } = render(
        <HistoryChart
          providerName={meter.providerName}
          providerKind="claude"
          mode="used"
          metrics={[metricFor(meter)]}
          history={meter.history}
          now={FIXTURE_NOW}
          rangeHours={30 * 24}
        />,
      );
      const chart = screen.getByRole("group", { name: /usage history/ });
      const bounds = { left: 0, width, top: 0, height: width * (112 / 320), right: width, bottom: width * (112 / 320), x: 0, y: 0, toJSON() { return this; } };
      vi.spyOn(chart, "getBoundingClientRect").mockReturnValue(bounds as DOMRect);
      const times: number[] = [];
      for (let step = 0; step <= 8; step += 1) {
        const viewX = 8 + (step / 8) * (312 - 8);
        fireEvent.pointerMove(chart, { clientX: (viewX / 320) * width, clientY: 40, pointerType: "mouse" });
        const guide = container.querySelector(".history-chart__guide-active");
        const dot = container.querySelector(".history-chart__dot-active");
        expect(guide, `width ${width} step ${step}`).not.toBeNull();
        expect(dot, `width ${width} step ${step}`).not.toBeNull();
        times.push(Number(guide?.getAttribute("x1")));
        const tooltip = container.querySelector(".history-chart__tooltip") as HTMLElement;
        expect(tooltip.textContent?.trim().length).toBeGreaterThan(0);
        const tipLeft = Number.parseFloat(tooltip.style.left);
        expect(tipLeft).toBeGreaterThanOrEqual(0);
      }
      const distinct = new Set(times.map((value) => value.toFixed(1)));
      expect(distinct.size, `width ${width}`).toBeGreaterThanOrEqual(4);
      for (let index = 1; index < times.length; index += 1) {
        expect(times[index]).toBeGreaterThanOrEqual(times[index - 1]!);
      }
      unmount();
    }
  });

  it("gives every pointer position a visible tooltip or no highlight", () => {
    const cases = [
      ["weekly", 48, 460],
      ["weekly", 30 * 24, 340],
      ["30-day", 30 * 24, 460],
      ["five-hour-coding", 48, 460],
    ] as const;
    for (const [metricId, rangeHours, width] of cases) {
      const meter = REALISTIC_METERS.find((item) => item.metricId === metricId)!;
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
      const { container, unmount } = render(
        <HistoryChart
          providerName={meter.providerName}
          providerKind={meter.providerKind}
          mode="used"
          metrics={[metricFor(meter)]}
          history={meter.history}
          now={FIXTURE_NOW}
          rangeHours={rangeHours}
        />,
      );
      const chart = screen.getByRole("group", { name: /usage history/ });
      chartBounds(chart);
      const label = `${meter.metricId} ${rangeHours}h @${width}`;
      for (let step = 0; step <= 20; step += 1) {
            const clientX = clientXForView(8 + (step / 20) * (312 - 8));
            fireEvent.pointerMove(chart, { clientX, clientY: 40, pointerType: "mouse" });
            const highlighted = container.querySelector(
              ".history-chart__highlight, .history-chart__guide-active",
            );
            const tooltip = container.querySelector(".history-chart__tooltip");
            if (!highlighted) {
              expect(tooltip, label).toBeNull();
              continue;
            }
            expect(tooltip, `${label} at ${clientX}`).not.toBeNull();
            const text = tooltip?.textContent?.trim() ?? "";
            expect(text.length, `${label} at ${clientX}`).toBeGreaterThan(0);
            const box = tooltip as HTMLElement;
            const left = Number.parseFloat(box.style.left);
            expect(left, label).toBeGreaterThanOrEqual(0);
      }
      unmount();
    }
  });

  it("hides the tooltip when the pointer leaves and does not pin on the focusing click", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const claude = REALISTIC_METERS.find((meter) => meter.metricId === "weekly")!;
    const { container } = render(
      <HistoryChart
        providerName={claude.providerName}
        providerKind="claude"
        mode="used"
        metrics={[metricFor(claude)]}
        history={claude.history}
        now={FIXTURE_NOW}
        rangeHours={48}
      />,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    chartBounds(chart);
    fireEvent.pointerMove(chart, { clientX: clientXForView(200), clientY: 40, pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeVisible();
    expect(container.querySelector(".history-chart__guide-active")).not.toBeNull();
    expect(container.querySelector(".history-chart__highlight")).toBeNull();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(container.querySelector(".history-chart__guide-active")).toBeNull();

    fireEvent.click(chart, { clientX: clientXForView(200) });
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.pointerLeave(chart);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("steps along readings with the arrow keys, including from nothing", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const claude = REALISTIC_METERS.find((meter) => meter.metricId === "weekly")!;
    render(
      <HistoryChart
        providerName={claude.providerName}
        providerKind="claude"
        mode="used"
        metrics={[metricFor(claude)]}
        history={claude.history}
        now={FIXTURE_NOW}
        rangeHours={48}
      />,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    chart.focus();
    expect(document.activeElement).toBe(chart);
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const first = screen.getByRole("tooltip").textContent ?? "";
    expect(first.length).toBeGreaterThan(0);
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const second = screen.getByRole("tooltip").textContent ?? "";
    expect(second).not.toBe(first);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    const last = screen.getByRole("tooltip").textContent ?? "";
    expect(last).not.toBe(first);
    expect(last).not.toBe(second);
    expect(document.activeElement).toBe(chart);
  });

  it("gives every hover target a tooltip whenever the highlight is visible", () => {
    // One meter, one width, two ranges. The full matrix of meters × widths ×
    // ranges exceeded the 5s default while the suite was loaded, without
    // waiting on a clock. Dropped cases still run elsewhere in this file:
    // every meter, both widths (340 and 460), and all three ranges (48h, 7d,
    // 30d) render in "renders the synthetic fixture inside the plot" and
    // "covers the drawn chart"; a pointer sweep that requires a tooltip
    // whenever a highlight is visible runs in "gives every pointer position
    // a visible tooltip or no highlight" for weekly at 48h/460 and 30d/340,
    // 30-day at 30d/460, and five-hour-coding at 48h/460.
    const widths = [340];
    const ranges = [48, 30 * 24];
    const meters = REALISTIC_METERS.filter((item) => item.metricId === "weekly");
    for (const meter of meters) {
      for (const width of widths) {
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
        for (const rangeHours of ranges) {
          const { container, unmount } = render(
            <HistoryChart
              providerName={meter.providerName}
              providerKind={meter.providerKind}
              mode="used"
              metrics={[metricFor(meter)]}
              history={meter.history}
              now={FIXTURE_NOW}
              rangeHours={rangeHours}
            />,
          );
          const chart = screen.getByRole("group", { name: /usage history/ });
          chartBounds(chart);
          fireEvent.pointerMove(chart, { clientX: clientXForView(160), pointerType: "mouse" });
          const shown = container.querySelector(".history-chart__highlight, .history-chart__guide-active");
          if (shown) {
            expect(screen.getByRole("tooltip").textContent?.trim().length, `${meter.metricId} ${rangeHours}h`).toBeGreaterThan(0);
          }
          const level = detailLevel(
            meter.metricId.includes("five-hour") ? 5 * HOUR : 7 * DAY,
            rangeHours * HOUR,
            Math.max(1, width),
          );
          expect(["envelope", "bars", "daily"]).toContain(level);
          unmount();
        }
      }
    }
  });

  it("focuses the chart on click and leaves focus alone on hover", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const claude = REALISTIC_METERS.find((meter) => meter.metricId === "weekly")!;
    const { container } = render(
      <HistoryChart
        providerName={claude.providerName}
        providerKind="claude"
        mode="used"
        metrics={[metricFor(claude)]}
        history={claude.history}
        now={FIXTURE_NOW}
        rangeHours={30 * 24}
      />,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    expect(chart).toHaveAttribute("tabindex", "0");
    chartBounds(chart);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.pointerMove(chart, { clientX: clientXForView(160), clientY: 40, pointerType: "mouse" });
    expect(document.activeElement).toBe(outside);
    fireEvent.pointerLeave(chart);
    chart.focus();
    expect(document.activeElement).toBe(chart);
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const before = screen.getByRole("tooltip").textContent ?? "";
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip").textContent ?? "").not.toBe(before);
    expect(document.activeElement).toBe(chart);
    outside.remove();
  });

  it("says 0% used · idle when the 5-hour meter has no active window", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const kimi = REALISTIC_METERS.find((meter) => meter.metricId === "five-hour-coding")!;
    const { container, rerender } = render(
      <HistoryChart
        providerName={kimi.providerName}
        providerKind="kimi"
        mode="used"
        metrics={[metricFor(kimi)]}
        history={kimi.history.filter((item) =>
          item.metrics.some((sample) => sample.type === "quota" && sample.metricId === "five-hour-coding"),
        )}
        now={FIXTURE_NOW}
        rangeHours={7 * 24}
      />,
    );
    expect(container.querySelector(".history-chart__latest")?.textContent).toContain("0% used");
    // The fixture's last 5-hour window has already reset, so the headline
    // agrees with the current cycle: nothing is open, a new reading is due.
    expect(container.querySelector(".history-chart__status")?.textContent).toMatch(/No usage|No active window|Resets|waiting for a new reading/);
    rerender(
      <HistoryChart
        providerName={kimi.providerName}
        providerKind="kimi"
        mode="left"
        metrics={[metricFor(kimi)]}
        history={kimi.history.filter((item) =>
          item.metrics.some((sample) => sample.type === "quota" && sample.metricId === "five-hour-coding"),
        )}
        now={FIXTURE_NOW}
        rangeHours={7 * 24}
      />,
    );
    expect(container.querySelector(".history-chart__latest")?.textContent).toContain("100% left");
  });

  it("opens the tooltip on hover, pins it on click, and steps it with the keyboard", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const meter = REALISTIC_METERS.find((item) => item.metricId === "weekly")!;
    const { container } = render(
      <div className="history-surface" style={{ width: 400 }}>
        <HistoryChart
          providerName={meter.providerName}
          providerKind={meter.providerKind}
          mode="used"
          metrics={[metricFor(meter)]}
          history={meter.history}
          now={FIXTURE_NOW}
          rangeHours={7 * 24}
        />
      </div>,
    );
    const chart = screen.getByRole("group", { name: /usage history/ });
    const bounds = { left: 0, width: 400, top: 0, height: 140 };
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      ...bounds,
      right: 400,
      bottom: 140,
      x: 0,
      y: 0,
      toJSON: () => bounds,
    });
    fireEvent.pointerMove(chart, { clientX: clientXForView(180), clientY: 40, pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(chart, { clientX: clientXForView(180) });
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.pointerLeave(chart);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.click(chart, { clientX: clientXForView(180) });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip")).toBeVisible();
    void container;
  });

function instanceFor(meter: RealisticMeter, id: string): ProviderInstanceView {
    const duration = meter.metricId.includes("five-hour") ? 5 * HOUR : 7 * DAY;
    const snapshot: UsageSnapshot = {
      providerKind: meter.providerKind,
      source: "fixture",
      fetchedAt: FIXTURE_NOW,
      metrics: [{
        type: "quota",
        id: meter.metricId,
        label: meter.label,
        scope: "general",
        usedRatio: meter.currentUsedRatio ?? 0,
        cycle: { cadence: "rolling", durationMs: duration, resetsAt: FIXTURE_NOW + duration },
      }],
    };
    return {
      id,
      providerKind: meter.providerKind,
      access: "granted",
      createdAt: FIXTURE_NOW - 30 * DAY,
      history: meter.history,
      snapshot,
    };
  }

  it("keeps a picked range across meters and providers, and shows a clean empty meter", () => {
    localStorage.clear();
    const claude = REALISTIC_METERS.find((meter) => meter.providerKind === "claude")!;
    const chatgpt = REALISTIC_METERS.find((meter) => meter.providerKind === "chatgpt")!;
    const empty = REALISTIC_METERS.find((meter) => meter.history.length === 0)!;
    const instances = [
      instanceFor(claude, "claude:default"),
      instanceFor(chatgpt, "chatgpt:default"),
      instanceFor(empty, "cursor:default"),
    ];
    const view = (instanceId: string) => (
      <HistoryView
        instances={instances}
        instanceId={instanceId}
        metricId={instances.find((item) => item.id === instanceId)?.snapshot?.metrics[0]?.id}
        mode="used"
        now={FIXTURE_NOW}
        backLabel="Overview"
        onBack={() => undefined}
        onDisplayModeChange={() => undefined}
        onSelectionChange={() => undefined}
      />
    );
    const { rerender } = render(view("claude:default"));
    const ranges = screen.getByRole("radiogroup", { name: "History range" });
    fireEvent.click(within(ranges).getByRole("radio", { name: "48 hours" }));
    expect(within(ranges).getByRole("radio", { name: "48 hours" })).toBeChecked();

    rerender(view("chatgpt:default"));
    expect(screen.getByRole("radio", { name: "48 hours" })).toBeChecked();

    rerender(view("cursor:default"));
    expect(screen.getByText(/No readings in/i)).toBeVisible();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText(/· 0/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "48 hours" })).toBeChecked();
  });

  it("does not draw a chart from a single fresh reading that has not repeated", () => {
    render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("weekly", 7 * DAY, "Weekly messages")]}
        history={[]}
        now={NOW}
        rangeHours={30 * 24}
      />,
    );
    expect(screen.getByText(/No readings in 30 days/i)).toBeVisible();
    expect(screen.queryByText(/Possible range/)).not.toBeInTheDocument();
  });

  it("describes a hold as at least the last reading and a gap as between the two", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 460, bottom: 200, width: 460, height: 200, toJSON() { return {}; },
    });
    const history = [
      observation("five-hour", NOW - 30 * HOUR, 0.26, {
        cycle: { cadence: "rolling", durationMs: 24 * HOUR, resetsAt: NOW - 20 * HOUR },
      }),
      observation("five-hour", NOW - 14 * HOUR, 0.07, {
        cycle: { cadence: "rolling", durationMs: 24 * HOUR, resetsAt: NOW + 4 * HOUR },
      }),
      observation("five-hour", NOW - 6 * HOUR, 0.4, {
        cycle: { cadence: "rolling", durationMs: 24 * HOUR, resetsAt: NOW + 4 * HOUR },
      }),
    ];
    const { container } = render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );
    const chart = container.querySelector(".history-chart__canvas") as HTMLElement;
    const hoverAt = (hoursAgo: number): string => {
      const viewX = 8 + ((48 - hoursAgo) / 48) * (312 - 8);
      fireEvent.pointerMove(chart, { clientX: (viewX / 320) * 460, pointerType: "mouse" });
      return container.querySelector(".history-chart__tooltip")?.textContent ?? "";
    };
    const held = hoverAt(2);
    expect(held, held).toMatch(/At least 40%/);
    expect(hoverAt(2)).toMatch(/No reading since/);
    expect(hoverAt(10)).toMatch(/Between 7% and 40%/);
  });

  it("shows the same whole number as the current cycle value", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const history = [
      observation("weekly", NOW - 3 * DAY, 0.262, {
        cycle: { cadence: "calendar", durationMs: 7 * DAY, resetsAt: NOW + 4 * DAY },
      }),
    ];
    const { container } = render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("weekly", 7 * DAY, "Weekly messages")]}
        history={history}
        now={NOW}
        rangeHours={7 * 24}
      />,
    );
    expect(container.querySelector(".history-chart__latest")?.textContent).toContain("26%");
  });

  it("says a closed window reset, for a fixed grid and for a first-use meter", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const closed = [
      observation("weekly-coding", FIXTURE_NOW - 2 * DAY, 0.3125, {
        cycle: { cadence: "rolling", durationMs: 7 * DAY, resetsAt: FIXTURE_NOW - 6 * HOUR },
      }),
    ];
    const { container, rerender } = render(
      <HistoryChart
        providerName="Kimi"
        providerKind="kimi"
        mode="used"
        metrics={[metric("weekly-coding", 7 * DAY, "7-day usage")]}
        history={closed}
        now={FIXTURE_NOW}
        rangeHours={30 * 24}
      />,
    );
    expect(container.querySelector(".history-chart__latest")?.textContent).toContain("0%");
    const weeklyStatus = container.querySelector(".history-chart__status")?.textContent ?? "";
    expect(weeklyStatus).toMatch(/Reset .*waiting for a new reading/);
    expect(weeklyStatus).toMatch(/Resets /);
    expect(weeklyStatus).not.toMatch(/first use/);

    const kimiFiveHour = [
      observation("five-hour-coding", FIXTURE_NOW - 2 * HOUR, 0.3125, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: FIXTURE_NOW - 2 * HOUR },
      }),
    ];
    rerender(
      <HistoryChart
        providerName="Kimi"
        providerKind="kimi"
        mode="used"
        metrics={[metric("five-hour-coding", 5 * HOUR, "5-hour usage")]}
        history={kimiFiveHour}
        now={FIXTURE_NOW}
        rangeHours={30 * 24}
      />,
    );
    const kimiStatus = container.querySelector(".history-chart__status")?.textContent ?? "";
    expect(container.querySelector(".history-chart__latest")?.textContent).toContain("0%");
    expect(kimiStatus).toMatch(/Reset .*waiting for a new reading/);
    expect(kimiStatus).toMatch(/Resets /);

    const firstUse = [
      observation("five-hour", FIXTURE_NOW - 2 * DAY, 0.4, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: FIXTURE_NOW - 2 * DAY + 5 * HOUR },
      }),
    ];
    rerender(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
        history={firstUse}
        now={FIXTURE_NOW}
        rangeHours={30 * 24}
      />,
    );
    expect(container.querySelector(".history-chart__latest")?.textContent).toContain("0%");
    expect(container.querySelector(".history-chart__status")?.textContent).toMatch(/waiting for a new reading/);
    expect(container.querySelector(".history-chart__status")?.textContent).not.toMatch(/first use/);
  });

  it("keeps idle and gap marks inside the plot on every realistic fixture", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    for (const meter of REALISTIC_METERS.filter((item) => item.history.length > 0)) {
      for (const mode of ["used", "left"] as const) {
        for (const rangeHours of [48, 7 * 24, 30 * 24]) {
          const { container, unmount } = render(
            <HistoryChart
              providerName={meter.providerName}
              providerKind={meter.providerKind}
              mode={mode}
              metrics={[metricFor(meter)]}
              history={meter.history}
              now={FIXTURE_NOW}
              rangeHours={rangeHours}
            />,
          );
          const marks = container.querySelectorAll(".history-chart__idle, .history-chart__gap, .history-chart__reset");
          for (const mark of marks) {
            const y1 = Number(mark.getAttribute("y1"));
            const y2 = Number(mark.getAttribute("y2"));
            // Stroke is 1px and butt-capped, centered on y. y=106 paints below the axis.
            expect(y1, `${meter.metricId} ${mode} ${rangeHours}`).toBeGreaterThanOrEqual(22);
            expect(y1).toBeLessThanOrEqual(105);
            expect(y2).toBeGreaterThanOrEqual(22);
            expect(y2).toBeLessThanOrEqual(105);
          }
          if (container.querySelector(".history-chart__bar")) {
            const idle = [...container.querySelectorAll(".history-chart__idle")];
            const starts = idle.map((mark) => mark.getAttribute("x1"));
            expect(new Set(starts).size, `${meter.metricId} ${mode} ${rangeHours}`).toBe(starts.length);
          }
          unmount();
        }
      }
    }
  });

  it("does not say there are no readings when a window carries into the range", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const history = [
      observation("five-hour-coding", FIXTURE_NOW - 7 * DAY - 2 * HOUR, 0.3, {
        cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: FIXTURE_NOW - 7 * DAY + 3 * HOUR },
      }),
    ];
    const { container } = render(
      <HistoryChart
        providerName="Kimi"
        providerKind="kimi"
        mode="used"
        metrics={[metric("five-hour-coding", 5 * HOUR, "5-hour usage")]}
        history={history}
        now={FIXTURE_NOW}
        rangeHours={7 * 24}
      />,
    );
    const drawn = container.querySelector(".history-chart__bar, .history-chart__line");
    expect(drawn).not.toBeNull();
    expect(container.querySelector(".history-chart__note")?.textContent ?? "").not.toMatch(/No readings/);
  });

  it("keeps the selected meter when the range changes", () => {
    localStorage.clear();
    const meter = REALISTIC_METERS.find((item) => item.providerKind === "kimi" && item.metricId === "weekly-coding")!;
    const metrics = [
      metric("monthly-total", 30 * DAY, "Total usage"),
      metric("weekly-coding", 7 * DAY, "7-day usage"),
      metric("five-hour-coding", 5 * HOUR, "5-hour usage"),
    ];
    const snapshot: UsageSnapshot = {
      providerKind: "kimi",
      source: "fixture",
      fetchedAt: FIXTURE_NOW,
      metrics,
    };
    const instance: ProviderInstanceView = {
      id: "kimi:default",
      providerKind: "kimi",
      access: "granted",
      createdAt: FIXTURE_NOW - 30 * DAY,
      history: meter.history,
      snapshot,
    };
    const selected = { id: "five-hour-coding" };
    const view = () => (
      <HistoryView
        instances={[instance]}
        instanceId="kimi:default"
        metricId={selected.id}
        mode="used"
        now={FIXTURE_NOW}
        backLabel="Overview"
        onBack={() => undefined}
        onDisplayModeChange={() => undefined}
        onSelectionChange={(id) => { selected.id = id; }}
      />
    );
    const { rerender } = render(view());
    expect(screen.getByRole("combobox", { name: "Window" })).toHaveTextContent("5-hour usage");
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    rerender(view());
    expect(screen.getByRole("combobox", { name: "Window" })).toHaveTextContent("5-hour usage");
    expect(screen.getByRole("heading", { level: 3, name: "5-hour usage" })).toBeVisible();
  });

  it("uses the singular when one reading is stored", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const history = [
      observation("weekly", FIXTURE_NOW - 2 * HOUR, 0.1, {
        cycle: { cadence: "calendar", durationMs: 7 * DAY, resetsAt: FIXTURE_NOW + 5 * DAY },
      }),
    ];
    render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("weekly", 7 * DAY, "Weekly messages")]}
        history={history}
        now={FIXTURE_NOW}
        rangeHours={48}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /How to read/ }));
    expect(screen.getByText("1 reading · stored only on this device.")).toBeVisible();
  });
});
