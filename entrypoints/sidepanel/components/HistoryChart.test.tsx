import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderInstanceView, UsageSnapshot } from "../../../domain/public-protocol";
import type { QuotaMetric, UsageHistoryObservation } from "../../../domain/model";
import { FIXTURE_NOW, REALISTIC_METERS, type RealisticMeter } from "../../../domain/history-realistic";
import { HistoryView } from "../views/HistoryView";
import { formatPercent } from "../../../i18n/format";
import { installI18nLocale } from "../../../test/i18n-harness";
import { HistoryChart } from "./HistoryChart";

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
  it("draws an envelope staircase for a wide short window in Used and Left", () => {
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
    expect(container.querySelectorAll(".history-chart__band").length).toBeGreaterThan(0);
    expect(container.querySelector(".history-chart__gap")).toBeNull();
    expect(screen.getByText("Readings")).toBeVisible();
    expect(screen.getByText("Possible range between readings")).toBeVisible();
    expect(screen.getByText(/Shaded = possible range between readings/)).toBeVisible();

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
    expect(screen.getByText(/% left/)).toBeVisible();
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
    expect(screen.getByText(/Bars show certain usage only/)).toBeVisible();

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
    expect(screen.getByText(/Each bar = busiest/)).toBeVisible();

    fireEvent.keyDown(screen.getByRole("group", { name: /usage history/ }), { key: "ArrowRight" });
    expect(container.querySelector(".history-chart__highlight")).not.toBeNull();
  });

  it("shows a window tooltip and moves between windows with the arrow keys", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    const { container } = render(
      <HistoryChart
        providerName="Claude"
        providerKind="claude"
        mode="used"
        metrics={[metric("five-hour", 5 * HOUR, "5-hour messages")]}
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
    const chart = screen.getByRole("group", { name: /usage history/ });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip")).toBeVisible();
    expect(container.querySelector(".history-chart__highlight")).not.toBeNull();
    const first = screen.getByRole("tooltip").textContent ?? "";
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip").textContent ?? "").not.toBe(first);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(chart).toHaveAccessibleDescription(/Use left and right arrow keys/);
  });

  it("uses the zh_CN catalog for the chart note and legend", () => {
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
    expect(screen.getByText("读数")).toBeVisible();
    expect(screen.getByText(/阴影 = 读数之间的可能范围/)).toBeVisible();
  });

  function metricFor(meter: RealisticMeter): QuotaMetric {
    return metric(
      meter.metricId,
      meter.metricId.includes("five-hour") ? 5 * HOUR : meter.metricId === "30-day" ? 30 * DAY : 7 * DAY,
      meter.label,
    );
  }

  function drawnOutsidePlot(container: HTMLElement): string[] {
    const plot = { left: 28, right: 312, top: 8, bottom: 92 };
    const epsilon = 0.6;
    const problems: string[] = [];
    const svg = container.querySelector("svg");
    if (!svg) return ["missing svg"];
    const clip = svg.querySelector("clipPath rect");
    if (!clip) problems.push("missing clip");
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
            expect(container.querySelector("clipPath")).not.toBeNull();
            if (meter.currentUsedRatio !== undefined) {
              const shown = mode === "used" ? meter.currentUsedRatio * 100 : (1 - meter.currentUsedRatio) * 100;
              const headline = container.querySelector(".history-chart__latest")?.textContent ?? "";
              expect(headline).toContain(`${formatPercent(Number(shown.toFixed(4)))}%`);
            }
            const unknown = [...container.querySelectorAll(".history-chart__unknown")];
            for (const box of unknown) {
              const x = Number(box.getAttribute("x"));
              const widthAttr = Number(box.getAttribute("width"));
              expect(x).toBeGreaterThanOrEqual(28);
              expect(x + widthAttr).toBeLessThanOrEqual(312.1);
            }
            unmount();
          }
        }
      }
    }
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
    fireEvent.pointerMove(chart, { clientX: 220, clientY: 40, pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const hit = container.querySelector(".history-chart__hit");
    expect(hit).not.toBeNull();
    fireEvent.click(hit!);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.pointerLeave(chart);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.click(hit!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(container.querySelector(".history-chart__highlight")).not.toBeNull();
    expect(screen.getByRole("tooltip")).toBeVisible();
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
    expect(screen.getByText("History starts after another successful refresh.")).toBeVisible();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
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
    expect(screen.getByText("History starts after another successful refresh.")).toBeVisible();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
