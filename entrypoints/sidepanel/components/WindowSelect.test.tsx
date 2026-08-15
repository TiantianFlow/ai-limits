import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowSelect } from "./WindowSelect";

const WINDOWS = [
  { id: "five-hour", label: "5-hour messages" },
  { id: "weekly", label: "Weekly messages" },
];

function renderSelect(onSelectionChange = vi.fn()) {
  render(
    <WindowSelect
      options={WINDOWS}
      selectedId="five-hour"
      onSelectionChange={onSelectionChange}
    />,
  );
  return onSelectionChange;
}

function combobox() {
  return screen.getByRole("combobox", { name: "Window" });
}

afterEach(cleanup);

describe("WindowSelect", () => {
  it("presents the selected quota window on a collapsed combobox trigger", () => {
    renderSelect();

    const trigger = combobox();
    expect(trigger).toHaveTextContent("5-hour messages");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens a trigger-aligned listbox with the quota windows only", () => {
    renderSelect();

    fireEvent.click(combobox());

    const listbox = screen.getByRole("listbox");
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    expect(combobox()).toHaveAttribute("aria-controls", listbox.id);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["5-hour messages", "Weekly messages"]);
    expect(
      screen.getByRole("option", { name: "5-hour messages" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("option", { name: "Weekly messages" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("selects an option with the pointer and restores focus to the trigger", () => {
    const onSelectionChange = renderSelect();

    fireEvent.click(combobox());
    fireEvent.click(screen.getByRole("option", { name: "Weekly messages" }));

    expect(onSelectionChange).toHaveBeenCalledWith("weekly");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveFocus();
  });

  it("navigates with arrow keys and selects with Enter", () => {
    const onSelectionChange = renderSelect();

    const trigger = combobox();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const weekly = screen.getByRole("option", { name: "Weekly messages" });
    expect(trigger).toHaveAttribute("aria-activedescendant", weekly.id);

    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onSelectionChange).toHaveBeenCalledWith("weekly");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not move above the first option with ArrowUp", () => {
    const onSelectionChange = renderSelect();

    const trigger = combobox();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    const first = screen.getByRole("option", { name: "5-hour messages" });
    expect(trigger).toHaveAttribute("aria-activedescendant", first.id);

    fireEvent.keyDown(trigger, { key: " " });
    expect(onSelectionChange).toHaveBeenCalledWith("five-hour");
  });

  it("closes on Escape and restores focus to the trigger", () => {
    renderSelect();

    const trigger = combobox();
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Tab without stealing focus", () => {
    renderSelect();

    fireEvent.click(combobox());
    fireEvent.keyDown(combobox(), { key: "Tab" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on an outside pointer down and restores focus to the trigger", () => {
    renderSelect();

    const trigger = combobox();
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
