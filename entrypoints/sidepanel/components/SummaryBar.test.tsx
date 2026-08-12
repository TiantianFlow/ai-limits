import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

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
});
