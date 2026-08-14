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
  it("renders reset-separated SVG paths with the current quota label and an accessible summary", () => {
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
    expect(screen.getByText("No observations")).toBeVisible();
    expect(screen.getByText("Reset or missing observations · line breaks")).toBeVisible();
    expect(container.querySelectorAll("rect.history-chart__break")).toHaveLength(1);
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
