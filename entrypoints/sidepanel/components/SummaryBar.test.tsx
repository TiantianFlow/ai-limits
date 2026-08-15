import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SummaryBar } from "./SummaryBar";

afterEach(cleanup);

describe("SummaryBar", () => {
  it.each([
    "Updated 2 of 4. Some providers need attention.",
    "Local usage data deleted. Some provider access could not be removed.",
  ])("uses the attention treatment for an actionable result: %s", (message) => {
    render(<SummaryBar message={message} />);

    expect(screen.getByRole("status")).toHaveClass("summary-bar--attention");
  });

  it("keeps a complete refresh neutral", () => {
    render(<SummaryBar message="Updated 4 providers." />);

    expect(screen.getByRole("status")).not.toHaveClass(
      "summary-bar--attention",
    );
  });

  it("offers a compact labeled dismiss button that calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <SummaryBar message="Updated 4 providers." onDismiss={onDismiss} />,
    );

    const dismiss = screen.getByRole("button", {
      name: "Dismiss refresh summary",
    });
    // The compact dismiss class keeps the close affordance out of the
    // banner's content-height determination (positioned via styles.css);
    // the global 44px button sizing stays the accessibility source of truth.
    expect(dismiss).toHaveClass("summary-bar__dismiss");
    expect(dismiss).toHaveTextContent("×");

    fireEvent.click(dismiss);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
