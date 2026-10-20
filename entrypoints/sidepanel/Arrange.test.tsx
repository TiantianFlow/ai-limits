import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AppViewState,
  ProviderInstanceView,
} from "../../domain/public-protocol";
import { createEmptyFixtureState } from "../../providers/fixtures";
import { withInstanceHidden, withInstanceOrder } from "./arrangement";
import { Cockpit } from "./Cockpit";

const NOW = Date.UTC(2026, 7, 7, 16);

afterEach(cleanup);

function instance(
  id: string,
  overrides: Partial<ProviderInstanceView> = {},
): ProviderInstanceView {
  return {
    id,
    providerKind: id.slice(0, id.indexOf(":")) as ProviderInstanceView["providerKind"],
    access: "granted",
    createdAt: NOW,
    history: [],
    ...overrides,
  };
}

function arrangedState(instances: ProviderInstanceView[]): AppViewState {
  return {
    preferences: { displayMode: "used", autoRefresh: true },
    providers: createEmptyFixtureState().providers,
    instances,
  };
}

function renderArranged(instances: ProviderInstanceView[]) {
  const onReorderInstances = vi.fn();
  const onSetInstanceHidden = vi.fn();
  const view = render(
    <Cockpit
      state={arrangedState(instances)}
      now={NOW}
      onDisplayModeChange={vi.fn()}
      onRefresh={vi.fn()}
      onConnectProvider={vi.fn()}
      onReorderInstances={onReorderInstances}
      onSetInstanceHidden={onSetInstanceHidden}
    />,
  );
  return { ...view, onReorderInstances, onSetInstanceHidden };
}

function overviewCardNames() {
  return screen
    .getAllByRole("button", { name: /^Refresh (?!usage)/ })
    .map((button) => button.getAttribute("aria-label")?.replace("Refresh ", ""));
}

describe("provider arrangement", () => {
  it("keeps hidden providers off the Overview cards and offers to show them", () => {
    const { onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default", { hidden: true }),
      instance("kimi:default"),
    ]);

    expect(overviewCardNames()).toEqual(["ChatGPT", "Kimi"]);
    expect(screen.getByText("1 hidden")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Claude" }));
    expect(onSetInstanceHidden).toHaveBeenCalledWith("claude:default", false);
  });

  it("explains an all-hidden Overview and shows every provider again", () => {
    const { onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default", { hidden: true }),
      instance("claude:default", { hidden: true }),
    ]);

    expect(
      screen.getByRole("heading", { name: "Every provider is hidden" }),
    ).toBeVisible();
    expect(screen.queryByText("2 hidden")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onSetInstanceHidden.mock.calls).toEqual([
      ["chatgpt:default", false],
      ["claude:default", false],
    ]);
  });

  it("arranges connected providers by keyboard without moving ones awaiting reconnection", () => {
    const { onReorderInstances, onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default"),
      instance("grok:default", { access: "required" }),
      instance("claude:default", { hidden: true }),
      instance("kimi:default"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveFocus();

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "ChatGPT",
      "Claude",
      "Kimi",
    ]);
    expect(
      screen.getByRole("switch", { name: "Show Claude on Overview" }),
    ).not.toBeChecked();

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Kimi" }), {
      key: "ArrowUp",
    });
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "chatgpt:default",
      "grok:default",
      "kimi:default",
      "claude:default",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kimi moved to position 2 of 3.",
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Kimi" }), {
      key: "Home",
    });
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "kimi:default",
      "grok:default",
      "chatgpt:default",
      "claude:default",
    ]);

    fireEvent.click(screen.getByRole("switch", { name: "Show ChatGPT on Overview" }));
    expect(onSetInstanceHidden).toHaveBeenCalledWith("chatgpt:default", true);

    fireEvent.click(done);
    expect(screen.getByRole("button", { name: "Arrange providers" })).toHaveFocus();
  });

  it("drags a provider by its handle to the slot under the pointer", () => {
    const { onReorderInstances } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default"),
      instance("kimi:default"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    rows.forEach((row, index) => {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: index * 50,
        height: 50,
        bottom: index * 50 + 50,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: index * 50,
        toJSON: () => ({}),
      });
    });

    const handle = screen.getByRole("button", { name: "Move ChatGPT" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 25 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 130 });
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Claude", "Kimi", "ChatGPT"]);
    expect(onReorderInstances).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 130 });
    expect(onReorderInstances).toHaveBeenCalledWith([
      "claude:default",
      "kimi:default",
      "chatgpt:default",
    ]);
  });

  it("keeps a drag in step with providers that disconnect meanwhile", () => {
    const { onReorderInstances, rerender } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default"),
      instance("kimi:default"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const handle = screen.getByRole("button", { name: "Move Kimi" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 0 });

    rerender(
      <Cockpit
        state={arrangedState([instance("chatgpt:default"), instance("kimi:default")])}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onReorderInstances={onReorderInstances}
      />,
    );
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["ChatGPT", "Kimi"]);

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: -10 });
    expect(onReorderInstances).toHaveBeenCalledWith([
      "kimi:default",
      "chatgpt:default",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kimi moved to position 1 of 2.",
    );
  });

  it("drops a cancelled drag without saving", () => {
    const { onReorderInstances } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const handle = screen.getByRole("button", { name: "Move ChatGPT" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onReorderInstances).not.toHaveBeenCalled();
  });

  it("moves and hides providers from Settings", () => {
    const { onReorderInstances, onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default", { hidden: true }),
      instance("grok:default", { access: "required" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Move ChatGPT up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Grok down" })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Show on Overview: Grok" }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Show on Overview: Claude" }),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Move Claude up" }));
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "claude:default",
      "chatgpt:default",
      "grok:default",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Move Claude down" }));
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "chatgpt:default",
      "grok:default",
      "claude:default",
    ]);

    fireEvent.click(screen.getByRole("switch", { name: "Show on Overview: Claude" }));
    expect(onSetInstanceHidden).toHaveBeenCalledWith("claude:default", false);
  });

  it("keeps keyboard focus on the handle as the row moves", () => {
    function Stateful() {
      const [state, setState] = useState(() =>
        arrangedState([
          instance("chatgpt:default"),
          instance("claude:default"),
          instance("kimi:default"),
        ]),
      );
      return (
        <Cockpit
          state={state}
          now={NOW}
          onDisplayModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onConnectProvider={vi.fn()}
          onReorderInstances={(ids) =>
            setState((current) => withInstanceOrder(current, ids))
          }
        />
      );
    }
    render(<Stateful />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const handle = screen.getByRole("button", { name: "Move ChatGPT" });
    handle.focus();

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });

    expect(screen.getByRole("button", { name: "Move ChatGPT" })).toHaveFocus();
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Claude", "Kimi", "ChatGPT"]);
  });

  it("moves focus to a provider's card after showing it", () => {
    function Stateful() {
      const [state, setState] = useState(() =>
        arrangedState([
          instance("chatgpt:default"),
          instance("claude:default", { hidden: true }),
        ]),
      );
      return (
        <Cockpit
          state={state}
          now={NOW}
          onDisplayModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onConnectProvider={vi.fn()}
          onSetInstanceHidden={(id, hidden) =>
            setState((current) => withInstanceHidden(current, id, hidden))
          }
        />
      );
    }
    render(<Stateful />);
    fireEvent.click(screen.getByRole("button", { name: "Show Claude" }));
    expect(document.activeElement).toHaveAttribute(
      "data-focus-key",
      "overview-provider-claude:default",
    );
  });
});
