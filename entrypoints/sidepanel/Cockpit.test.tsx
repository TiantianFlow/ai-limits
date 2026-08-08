import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppState } from "../../domain/model";
import { createFixtureState } from "../../providers/fixtures";
import { createInitialState } from "../../providers/initial-state";
import { Cockpit } from "./Cockpit";

const NOW = Date.UTC(2026, 7, 7, 16);

afterEach(cleanup);

function renderCockpit(
  state: AppState = createFixtureState(NOW),
  onDisplayModeChange = vi.fn(),
) {
  render(
    <Cockpit
      state={state}
      now={NOW}
      onDisplayModeChange={onDisplayModeChange}
      onRefresh={vi.fn()}
      onConnectProvider={vi.fn()}
    />,
  );

  return { onDisplayModeChange };
}

describe("Cockpit", () => {
  it("starts with honest provider session checks and no demo usage", () => {
    const state = createInitialState();

    render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    expect(screen.queryByText(/% used/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check ChatGPT session" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Check Claude session" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Check Kimi session" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Check Cursor session" })).toBeVisible();
    expect(screen.getByText("Antigravity")).toBeVisible();
    expect(screen.getByText("Experimental")).toBeVisible();
  });

  it("renders connected quota pace, credits, and experimental state", () => {
    renderCockpit();

    expect(screen.getByText("ChatGPT")).toBeVisible();
    expect(screen.getByText("72% used")).toBeVisible();
    expect(screen.getAllByText("5 / 7 days elapsed")[0]).toBeVisible();
    expect(screen.getByText("$8.20 / $20.00 used")).toBeVisible();
    expect(screen.getByText("Experimental")).toBeVisible();
  });

  it("keeps an absolute credit balance unchanged in Used and Left modes", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.snapshot!.credits = [
      {
        id: "credits",
        label: "Credits",
        unit: "credits",
        remaining: 414,
      },
    ];
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.getByText("414 credits")).toBeVisible();

    view.rerender(
      <Cockpit
        state={{ ...state, preferences: { displayMode: "left" } }}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(screen.getByText("414 credits")).toBeVisible();
  });

  it("requests left mode and renders the complementary percentage", () => {
    const onDisplayModeChange = vi.fn();
    const state = createFixtureState(NOW);
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={onDisplayModeChange}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    const weekly = within(screen.getByRole("group", { name: "Weekly messages" }));
    const pace = weekly.getByText(/points? ahead|On pace|points? behind/).textContent;

    expect(
      weekly.getByRole("progressbar", { name: "Weekly messages time elapsed" }),
    ).toHaveAttribute("aria-valuenow", "71");
    expect(weekly.getByText("5 / 7 days elapsed")).toBeVisible();

    const reset = weekly.getByText(/^Resets /);
    expect(reset.tagName).toBe("TIME");
    expect(reset).toHaveAttribute(
      "datetime",
      new Date(state.providers[0]!.snapshot!.windows[1]!.resetsAt!).toISOString(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    expect(onDisplayModeChange).toHaveBeenCalledWith("left");

    view.rerender(
      <Cockpit
        state={{
          ...state,
          preferences: { ...state.preferences, displayMode: "left" },
        }}
        now={NOW}
        onDisplayModeChange={onDisplayModeChange}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.getByText("28% left")).toBeVisible();
    const remainingWeekly = within(
      screen.getByRole("group", { name: "Weekly messages" }),
    );
    expect(
      remainingWeekly.getByRole("progressbar", {
        name: "Weekly messages time remaining",
      }),
    ).toHaveAttribute("aria-valuenow", "29");
    expect(remainingWeekly.getByText("2 / 7 days left")).toBeVisible();
    expect(remainingWeekly.getByText(pace!)).toBeVisible();
  });

  it("keeps the display selector with the global header actions", () => {
    renderCockpit();

    const header = screen.getByRole("heading", { name: "AI Limits" }).closest("header");
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole("group", { name: "Display usage as" }),
    ).toBeVisible();
    expect(screen.queryByText("Show")).not.toBeInTheDocument();
  });

  it("omits the wall-time track when a window has no timing bounds", () => {
    const state = createFixtureState(NOW);
    const chatGpt = state.providers[0];

    if (!chatGpt?.snapshot) {
      throw new Error("Expected the ChatGPT fixture snapshot.");
    }

    const untimedState: AppState = {
      ...state,
      providers: [
        {
          ...chatGpt,
          snapshot: {
            ...chatGpt.snapshot,
            windows: [
              {
                ...chatGpt.snapshot.windows[0]!,
                startedAt: undefined,
                resetsAt: undefined,
                durationMs: undefined,
              },
            ],
          },
        },
      ],
    };

    renderCockpit(untimedState);

    const quotaGroup = screen.getByRole("group", { name: "5-hour messages" });
    expect(
      within(quotaGroup).getByRole("progressbar", {
        name: "5-hour messages quota used",
      }),
    ).toBeVisible();
    expect(
      within(quotaGroup).queryByRole("progressbar", {
        name: "5-hour messages time elapsed",
      }),
    ).not.toBeInTheDocument();
  });

  it("labels all icon actions for assistive technology", () => {
    renderCockpit(createInitialState());

    expect(screen.getByRole("button", { name: "Refresh usage" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Check ChatGPT session" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  it("dispatches session checks with the selected provider identity", () => {
    const onConnectProvider = vi.fn();
    render(
      <Cockpit
        state={createInitialState()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={onConnectProvider}
      />,
    );

    const connect = screen.getByRole("button", { name: "Check Claude session" });
    expect(connect).toHaveTextContent("Check session");
    fireEvent.click(connect);
    expect(onConnectProvider).toHaveBeenCalledWith("claude");
  });

  it("hides the session check while that provider is connecting", () => {
    const state = createInitialState();
    state.providers[0]!.health = { kind: "connecting" };

    renderCockpit(state);

    expect(
      screen.queryByRole("button", { name: "Check ChatGPT session" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Connecting")).toBeVisible();
  });

  it("shows live source and removes the connection action after collection", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.snapshot!.source = "web-session";

    renderCockpit(state);

    expect(screen.getByText("Live")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Check ChatGPT session" }),
    ).not.toBeInTheDocument();
  });

  it("shows failed snapshot-free health in the padded empty state", () => {
    const state = createInitialState();
    state.providers[0]!.health = {
      kind: "signed_out",
      message: "Sign in to ChatGPT and try again.",
    };

    renderCockpit(state);

    const card = screen.getByRole("article", { name: "ChatGPT" });
    const emptyState = card.querySelector(".provider-card__empty");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).getByText("Sign in to ChatGPT and try again.")).toBeVisible();
    expect(screen.queryByText("72% used")).not.toBeInTheDocument();
  });
});
