import { render, screen } from "@testing-library/react";
import React from "react";
import { expect, test } from "vitest";

import { StatusChip } from "./StatusChip";

test("keeps the status dot and label in one semantic token", () => {
  render(<StatusChip label="Updated just now" />);

  const label = screen.getByText("Updated just now");
  const chip = label.closest(".status-chip");

  expect(label).toHaveClass("status-chip__label");
  expect(chip).toHaveAttribute("title", "Updated just now");
  expect(chip?.querySelector(".status-chip__dot")).not.toBeNull();
});
