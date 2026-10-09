import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QuotaMetric, UsageHistoryObservation } from "../../../domain/model";
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
  });

  it("shows a window tooltip and moves between windows with the arrow keys", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(460);
    render(
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
