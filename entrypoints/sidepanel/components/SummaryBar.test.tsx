import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SummaryBar } from "./SummaryBar";

afterEach(cleanup);

describe("SummaryBar", () => {
  it("uses the attention treatment from a semantic tone, not message text", () => {
    render(
      <SummaryBar
        message="Updated 2 of 4. Some providers need attention."
        tone="attention"
      />,
    );

    expect(screen.getByRole("status")).toHaveClass("summary-bar--attention");
  });

  it("keeps a complete refresh success tone even if the copy mentions attention words", () => {
    render(
      <SummaryBar
        message="Updated 4 providers. Some providers need attention."
        tone="success"
      />,
    );

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
