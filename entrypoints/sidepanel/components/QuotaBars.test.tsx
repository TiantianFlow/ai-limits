import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuotaBars } from "./QuotaBars";

const quota = {
  id: "monthly-total",
  label: "Monthly total",
  mode: "used" as const,
  quotaPercent: 10,
  usedPercent: 10,
  valueLabel: "100 / 1,000",
  timePercent: 63,
  timeLabel: "19 / 30 days elapsed",
  resetAt: Date.UTC(2026, 7, 20, 16),
  resetLabel: "Resets Aug 20, 12:00 PM",
  paceKind: "behind" as const,
  paceLabel: "53 pts under pace",
};

afterEach(cleanup);

describe("QuotaBars", () => {
  it("renders exact zero, sub-1%, and sub-2% meter widths without a fabricated minimum", () => {
    const { rerender } = render(
      <QuotaBars
        {...quota}
        label="Unused window"
        quotaPercent={0}
        timePercent={0}
      />,
    );

    const group = screen.getByRole("group", { name: "Unused window" });
    const quotaMeter = within(group).getByRole("meter", {
      name: "Unused window quota used",
    });
    const timeMeter = within(group).getByRole("meter", {
      name: "Unused window time elapsed",
    });

    expect(quotaMeter.firstElementChild).toHaveStyle({ width: "0%" });
    expect(timeMeter.firstElementChild).toHaveStyle({ width: "0%" });

    rerender(
      <QuotaBars
        {...quota}
        label="Tiny window"
        quotaPercent={0.5}
        timePercent={1.25}
      />,
    );
    const tinyGroup = screen.getByRole("group", { name: "Tiny window" });
    expect(
      within(tinyGroup).getByRole("meter", { name: "Tiny window quota used" })
        .firstElementChild,
    ).toHaveStyle({ width: "0.5%" });
    expect(
      within(tinyGroup).getByRole("meter", { name: "Tiny window time elapsed" })
        .firstElementChild,
    ).toHaveStyle({ width: "1.25%" });
  });

  it("stacks truthful composition segments only in Used mode", () => {
    const { rerender } = render(
      <QuotaBars
        {...quota}
        segments={[
          { id: "work", label: "Work", percent: 3 },
          { id: "code", label: "Code", percent: 7 },
        ]}
      />,
    );

    const usedMeter = screen.getByRole("meter", {
      name: "Monthly total quota used",
    });
    expect(
      Array.from(usedMeter.children).map((segment) =>
        segment.getAttribute("style"),
      ),
    ).toEqual(["width: 3%;", "width: 7%;"]);
    expect(screen.getByText("Work 3%")).toBeVisible();
    expect(screen.getByText("Code 7%")).toBeVisible();
    expect(screen.queryByText("Total 10% used")).not.toBeInTheDocument();

    rerender(
      <QuotaBars
        {...quota}
        mode="left"
        quotaPercent={90}
        timePercent={37}
        timeLabel="11 / 30 days remaining"
        segments={[
          { id: "work", label: "Work", percent: 3 },
          { id: "code", label: "Code", percent: 7 },
        ]}
      />,
    );

    const leftMeter = screen.getByRole("meter", {
      name: "Monthly total quota left",
    });
    expect(leftMeter.children).toHaveLength(1);
    expect(leftMeter.firstElementChild).toHaveStyle({ width: "90%" });
  });

  it.each([
    { usedPercent: 74.999, mode: "used" as const, quotaPercent: 74.999, tone: "accent" },
    { usedPercent: 75, mode: "left" as const, quotaPercent: 25, tone: "warning" },
    { usedPercent: 91.999, mode: "used" as const, quotaPercent: 91.999, tone: "warning" },
    { usedPercent: 92, mode: "left" as const, quotaPercent: 8, tone: "critical" },
  ])(
    "uses the canonical $tone tone at $usedPercent% consumed in $mode mode",
    ({ usedPercent, mode, quotaPercent, tone }) => {
      render(
        <QuotaBars
          {...quota}
          mode={mode}
          quotaPercent={quotaPercent}
          usedPercent={usedPercent}
        />,
      );

      const meter = screen.getByRole("meter", {
        name: `Monthly total quota ${mode}`,
      });
      expect(meter.firstElementChild).toHaveClass(`meter__fill--${tone}`);
    },
  );

  it("shows production counts, reset timing, pace, and the History action", () => {
    const onOpenHistory = vi.fn();
    render(<QuotaBars {...quota} onOpenHistory={onOpenHistory} />);

    expect(screen.getByText("100 / 1,000")).toBeVisible();
    expect(screen.getByText("10% used")).toBeVisible();
    expect(screen.getByText("19 / 30 days elapsed")).toBeVisible();
    expect(screen.getByText("53 pts under pace")).toBeVisible();
    const primaryMetadata = document.querySelector(".quota-bars__meta-primary");
    const resetMetadata = document.querySelector(".quota-bars__reset");
    expect(primaryMetadata).toContainElement(
      screen.getByText("19 / 30 days elapsed"),
    );
    expect(primaryMetadata).not.toContainElement(
      screen.getByText("Resets Aug 20, 12:00 PM"),
    );
    expect(resetMetadata).toContainElement(
      screen.getByText("Resets Aug 20, 12:00 PM"),
    );
    expect(screen.getByText("Resets Aug 20, 12:00 PM")).toHaveAttribute(
      "datetime",
      new Date(quota.resetAt).toISOString(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open history for Monthly total",
      }),
    );
    expect(onOpenHistory).toHaveBeenCalledOnce();
    expect(onOpenHistory).toHaveBeenCalledWith("monthly-total");
  });
});
