import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  UsageHistoryObservation,
  QuotaMetric,
} from "../../../domain/model";
import { HistoryChart } from "./HistoryChart";

const HOUR = 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 10, 16);
const FIRST_RESET = NOW - 2 * HOUR;
const SECOND_RESET = NOW + 7 * 24 * HOUR;

const metrics: QuotaMetric[] = [
  {
    type: "quota",
    id: "weekly",
    label: "Weekly messages",
    scope: "general",
    usedRatio: 0.42,
    cycle: { cadence: "rolling", resetsAt: SECOND_RESET, durationMs: 7 * 24 * HOUR },
  },
];

function observation(observedAt: number, usedRatio: number, resetsAt: number): UsageHistoryObservation {
  return {
    observedAt,
    metrics: [{ type: "quota", metricId: "weekly", usedRatio, cycle: { cadence: "rolling", resetsAt } }],
  };
}

const history: UsageHistoryObservation[] = [
  observation(NOW - 4 * HOUR, 0.76, FIRST_RESET),
  observation(NOW - 3 * HOUR, 0.91, FIRST_RESET),
  observation(NOW - HOUR, 0.18, SECOND_RESET),
  observation(NOW, 0.42, SECOND_RESET),
];

afterEach(cleanup);

describe("HistoryChart", () => {
  it("bridges short holes, breaks the line at a reset, and labels the fitted trend", () => {
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );

    const chart = screen.getByRole("img", {
      name: /ChatGPT Weekly messages usage history/,
    });
    expect(chart).toBeVisible();
    expect(chart).toHaveAttribute("viewBox", "0 0 320 112");
    expect(
      container.querySelectorAll("path.history-chart__line"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("path.history-chart__line")[0],
    ).toHaveAttribute("vector-effect", "non-scaling-stroke");
    const areas = container.querySelectorAll("path.history-chart__area");
    expect(areas).toHaveLength(2);
    expect(Array.from(areas, (area) => area.getAttribute("d"))).toEqual([
      expect.stringMatching(/^M .* L .* L .* L .* Z$/),
      expect.stringMatching(/^M .* L .* L .* L .* Z$/),
    ]);
    expect(screen.getByText("42% used")).toBeVisible();
    expect(screen.getByText("48 hours ago")).toBeVisible();
    expect(screen.getByText("Now")).toBeVisible();
    expect(
      screen.getByText(/4 observations across 2 chart segments/),
    ).toHaveClass("visually-hidden");
    expect(screen.getByText("Observed quota used")).toBeVisible();
    expect(screen.getAllByText("Quota reset").length).toBeGreaterThan(0);
    expect(screen.queryByText("Trend (fitted)")).not.toBeInTheDocument();
    expect(screen.queryByText("Long gap")).not.toBeInTheDocument();
    expect(screen.getByText(/short missed reads bridged in this range/)).toBeVisible();
    expect(screen.getByText(/only gaps over 2 h are shaded/)).toBeVisible();
    expect(container.querySelectorAll("rect.history-chart__gap")).toHaveLength(0);
    expect(container.querySelectorAll("line.history-chart__reset")).toHaveLength(1);
    expect(container.querySelectorAll("line.history-chart__trend")).toHaveLength(0);
    expect(chart).toHaveAccessibleName(/6 short missed reads are bridged/);
    expect(chart).toHaveAccessibleName(/No long gaps/);
    expect(chart).toHaveAccessibleName(/The line breaks at quota resets/);
    expect(chart).not.toHaveAccessibleName(/dashed fitted trend line/);
    expect(chart).not.toHaveAccessibleName(/long gaps are shaded/);
  });

  it("shades only a long gap and marks a plan-limit change without bridging it", () => {
    const longGap: UsageHistoryObservation[] = [
      observation(NOW - 30 * HOUR, 0.2, FIRST_RESET),
      observation(NOW - 29 * HOUR, 0.4, FIRST_RESET),
      observation(NOW - 28 * HOUR, 0.6, FIRST_RESET),
      {
        observedAt: NOW - 20 * HOUR,
        metrics: [{
          type: "quota",
          metricId: "weekly",
          usedRatio: 0.15,
          limit: 100,
          cycle: { cadence: "rolling", resetsAt: FIRST_RESET },
        }],
      },
      {
        observedAt: NOW - 18 * HOUR,
        metrics: [{
          type: "quota",
          metricId: "weekly",
          usedRatio: 0.3,
          limit: 100,
          cycle: { cadence: "rolling", resetsAt: FIRST_RESET },
        }],
      },
      {
        observedAt: NOW,
        metrics: [{
          type: "quota",
          metricId: "weekly",
          usedRatio: 0.45,
          limit: 160,
          cycle: { cadence: "rolling", resetsAt: FIRST_RESET },
        }],
      },
    ];
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={longGap}
        now={NOW}
        rangeHours={48}
      />,
    );

    const gap = container.querySelector("rect.history-chart__gap");
    expect(gap).not.toBeNull();
    expect(gap?.querySelector("title")?.textContent).toMatch(/No observations/);
    expect(container.querySelectorAll("line.history-chart__gap-edge")).toHaveLength(1);
    expect(container.querySelectorAll("line.history-chart__limit")).toHaveLength(1);
    expect(container.querySelector("line.history-chart__limit title")?.textContent).toBe(
      "Plan limit changed · series restarts",
    );
    expect(
      screen.getByRole("img", { name: /ChatGPT Weekly messages usage history/ }),
    ).toHaveAccessibleName(/1 long gap shaded: No observations · 8 hours/);
    expect(
      screen.getByRole("img", { name: /ChatGPT Weekly messages usage history/ }),
    ).toHaveAccessibleName(/The line breaks where the plan limit changed/);
    expect(screen.getByText("Long gap")).toBeVisible();
    expect(screen.getByText("Plan limit changed")).toBeVisible();
    expect(container.querySelectorAll("path.history-chart__line")).toHaveLength(3);
  });

  it("shades every long gap, skips bridged holes, and keeps the hover label inside the plot", () => {
    const minute = 60 * 1_000;
    const samples: UsageHistoryObservation[] = [];
    const start = NOW - 48 * HOUR;
    for (let at = start; at <= NOW; at += 15 * minute) {
      const missed = [3, 9].some((step) => at === start + step * 15 * minute);
      const inLongHole = at > NOW - 26 * HOUR && at < NOW - 21.5 * HOUR;
      if (missed || inLongHole) continue;
      samples.push(observation(at, 0.3, FIRST_RESET));
    }
    // A second long hole flush against the right edge of the 48 h window.
    const edge = samples.filter(
      (sample) => sample.observedAt < NOW - 3 * HOUR || sample.observedAt === NOW,
    );

    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={edge}
        now={NOW}
        rangeHours={48}
      />,
    );

    const gaps = container.querySelectorAll("rect.history-chart__gap");
    expect(gaps).toHaveLength(2);
    for (const label of container.querySelectorAll("g.history-chart__gap-label")) {
      const labelX = Number(label.getAttribute("transform")?.match(/translate\(([-\d.]+)/)?.[1]);
      const labelWidth = Number(label.querySelector("rect")?.getAttribute("width"));
      expect(labelX).toBeGreaterThanOrEqual(28);
      expect(labelX + labelWidth).toBeLessThanOrEqual(312);
    }
  });

  it("draws the fitted trend offset from a linear observed series", () => {
    const linear: UsageHistoryObservation[] = [0, 1, 2, 3].map((step) =>
      observation(NOW - (3 - step) * HOUR, 0.2 + step * 0.1, FIRST_RESET),
    );
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={linear}
        now={NOW}
        rangeHours={48}
      />,
    );

    const trend = container.querySelector("line.history-chart__trend");
    const observed = container.querySelector("path.history-chart__line");
    expect(trend).not.toBeNull();
    const observedStartY = Number(observed?.getAttribute("d")?.match(/M [-\d.]+ ([-\d.]+)/)?.[1]);
    expect(Number(trend?.getAttribute("y1"))).toBeGreaterThan(observedStartY);
  });

  it("complements the fitted trend when rendering Left mode", () => {
    const rising: UsageHistoryObservation[] = [
      observation(NOW - 2 * HOUR, 0.2, FIRST_RESET),
      observation(NOW - HOUR, 0.4, FIRST_RESET),
      observation(NOW, 0.6, FIRST_RESET),
    ];
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="left"
        metrics={metrics}
        history={rising}
        now={NOW}
        rangeHours={48}
      />,
    );

    const trend = container.querySelector("line.history-chart__trend");
    expect(trend).not.toBeNull();
    expect(Number(trend?.getAttribute("y2"))).toBeGreaterThan(
      Number(trend?.getAttribute("y1")),
    );
    expect(screen.getByText("Trend (fitted)")).toBeVisible();
    expect(
      screen.getByRole("img", { name: /ChatGPT Weekly messages usage history/ }),
    ).toHaveAccessibleName(/dashed fitted trend line is an estimate, not observed data/);
  });

  it("renders visible markers without connecting reset-separated singleton segments", () => {
    const singletonHistory: UsageHistoryObservation[] = [
      observation(NOW - HOUR, 0.91, FIRST_RESET),
      observation(NOW, 0.18, SECOND_RESET),
    ];
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={singletonHistory}
        now={NOW}
      />,
    );

    expect(
      container.querySelectorAll("path.history-chart__line"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("circle.history-chart__marker"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("path.history-chart__area"),
    ).toHaveLength(0);
    expect(
      Array.from(
        container.querySelectorAll("path.history-chart__line"),
        (path) => path.getAttribute("d")?.includes("L"),
      ),
    ).toEqual([false, false]);
  });

  it("adapts the truthful range endpoint label to the active range", () => {
    const { rerender } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={history}
        now={NOW}
        rangeHours={48}
      />,
    );

    expect(screen.getByText("48 hours ago")).toBeVisible();
    expect(screen.getByText("Now")).toBeVisible();

    rerender(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={history}
        now={NOW}
        rangeHours={7 * 24}
      />,
    );

    expect(screen.getByText("7 days ago")).toBeVisible();
    expect(screen.getByText("Now")).toBeVisible();
  });

  it("complements canonical used ratios only when rendering Left mode", () => {
    render(
      <HistoryChart
        providerName="ChatGPT"
        mode="left"
        metrics={metrics}
        history={history}
        now={NOW}
      />,
    );

    expect(screen.getByText("58% left")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /ChatGPT Weekly messages usage history/,
      }),
    ).toHaveAccessibleDescription(/latest value is 58% left/i);
  });

  it("keeps the valid fallback selected when a removed metric later returns", () => {
    const fiveHourMetric: QuotaMetric = {
      type: "quota",
      id: "five-hour",
      label: "5-hour messages",
      scope: "general",
      usedRatio: 0.2,
      cycle: { cadence: "rolling", resetsAt: NOW + HOUR, durationMs: 5 * HOUR },
    };
    const currentMetrics = [fiveHourMetric, metrics[0]!];
    const view = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={currentMetrics}
        history={history}
        now={NOW}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Quota metric" }), {
      target: { value: "weekly" },
    });
    expect(
      screen.getByRole("combobox", { name: "Quota metric" }),
    ).toHaveValue("weekly");

    view.rerender(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={[fiveHourMetric]}
        history={history}
        now={NOW}
      />,
    );
    view.rerender(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={currentMetrics}
        history={history}
        now={NOW}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Quota metric" }),
    ).toHaveValue("five-hour");
  });

  it("does not imply a trend from a single observation", () => {
    render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        metrics={metrics}
        history={history.slice(-1)}
        now={NOW}
      />,
    );

    expect(
      screen.getByText("History starts after another successful refresh."),
    ).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
