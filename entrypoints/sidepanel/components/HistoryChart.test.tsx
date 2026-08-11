import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  QuotaHistoryObservation,
  QuotaWindow,
} from "../../../domain/model";
import { HistoryChart } from "./HistoryChart";

const HOUR = 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 10, 16);
const FIRST_RESET = NOW - 2 * HOUR;
const SECOND_RESET = NOW + 7 * 24 * HOUR;

const windows: QuotaWindow[] = [
  {
    id: "weekly",
    label: "Weekly messages",
    kind: "rolling",
    usedRatio: 0.42,
    resetsAt: SECOND_RESET,
    durationMs: 7 * 24 * HOUR,
    sourceSemantics: "used",
  },
];

const history: QuotaHistoryObservation[] = [
  {
    observedAt: NOW - 4 * HOUR,
    windows: [{ windowId: "weekly", usedRatio: 0.76, resetsAt: FIRST_RESET }],
  },
  {
    observedAt: NOW - 3 * HOUR,
    windows: [{ windowId: "weekly", usedRatio: 0.91, resetsAt: FIRST_RESET }],
  },
  {
    observedAt: NOW - HOUR,
    windows: [{ windowId: "weekly", usedRatio: 0.18, resetsAt: SECOND_RESET }],
  },
  {
    observedAt: NOW,
    windows: [{ windowId: "weekly", usedRatio: 0.42, resetsAt: SECOND_RESET }],
  },
];

afterEach(cleanup);

describe("HistoryChart", () => {
  it("renders reset-separated SVG paths with the current quota label and an accessible summary", () => {
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        windows={windows}
        history={history}
        now={NOW}
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
    expect(screen.getByText("42% used")).toBeVisible();
    expect(screen.getByText(/History from .* to .*/)).toBeVisible();
    expect(
      screen.getByText(/4 observations across 2 chart segments/),
    ).toHaveClass("visually-hidden");
  });

  it("renders visible markers without connecting reset-separated singleton segments", () => {
    const singletonHistory: QuotaHistoryObservation[] = [
      {
        observedAt: NOW - HOUR,
        windows: [
          { windowId: "weekly", usedRatio: 0.91, resetsAt: FIRST_RESET },
        ],
      },
      {
        observedAt: NOW,
        windows: [
          { windowId: "weekly", usedRatio: 0.18, resetsAt: SECOND_RESET },
        ],
      },
    ];
    const { container } = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        windows={windows}
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
      Array.from(
        container.querySelectorAll("path.history-chart__line"),
        (path) => path.getAttribute("d")?.includes("L"),
      ),
    ).toEqual([false, false]);
  });

  it("complements canonical used ratios only when rendering Left mode", () => {
    render(
      <HistoryChart
        providerName="ChatGPT"
        mode="left"
        windows={windows}
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

  it("keeps the valid fallback selected when a removed window later returns", () => {
    const fiveHourWindow: QuotaWindow = {
      id: "five-hour",
      label: "5-hour messages",
      kind: "rolling",
      usedRatio: 0.2,
      resetsAt: NOW + HOUR,
      durationMs: 5 * HOUR,
      sourceSemantics: "used",
    };
    const currentWindows = [fiveHourWindow, windows[0]!];
    const view = render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        windows={currentWindows}
        history={history}
        now={NOW}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Quota window" }), {
      target: { value: "weekly" },
    });
    expect(
      screen.getByRole("combobox", { name: "Quota window" }),
    ).toHaveValue("weekly");

    view.rerender(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        windows={[fiveHourWindow]}
        history={history}
        now={NOW}
      />,
    );
    view.rerender(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        windows={currentWindows}
        history={history}
        now={NOW}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Quota window" }),
    ).toHaveValue("five-hour");
  });

  it("does not imply a trend from a single observation", () => {
    render(
      <HistoryChart
        providerName="ChatGPT"
        mode="used"
        windows={windows}
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
