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
      onConnectChatGpt={vi.fn()}
    />,
  );

  return { onDisplayModeChange };
}

describe("Cockpit", () => {
  it("renders fixture providers, quota pace, credits, and experimental state", () => {
    renderCockpit();

    expect(screen.getByText("Demo data")).toBeVisible();
    expect(screen.getByText("ChatGPT")).toBeVisible();
    expect(screen.getByText("72% used")).toBeVisible();
    expect(screen.getAllByText(/time 5 \/ 7 days/)[0]).toBeVisible();
    expect(screen.getByText("$8.20 / $20.00 used")).toBeVisible();
    expect(screen.getByText("Experimental")).toBeVisible();
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
        onConnectChatGpt={vi.fn()}
      />,
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
        onConnectChatGpt={vi.fn()}
      />,
    );

    expect(screen.getByText("28% left")).toBeVisible();
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
    renderCockpit();

    expect(screen.getByRole("button", { name: "Refresh usage" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  it("offers an explicit live connection action only for the ChatGPT fixture", () => {
    const onConnectChatGpt = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectChatGpt={onConnectChatGpt}
      />,
    );

    const connect = screen.getByRole("button", { name: "Connect ChatGPT" });
    expect(connect).toHaveTextContent("Connect live");
    fireEvent.click(connect);
    expect(onConnectChatGpt).toHaveBeenCalledTimes(1);
  });

  it("shows live source and removes the connection action after collection", () => {
    const state = createFixtureState(NOW);
    state.demoMode = false;
    state.providers[0]!.snapshot!.source = "web-session";

    renderCockpit(state);

    expect(screen.getByText("Live")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connect ChatGPT" }),
    ).not.toBeInTheDocument();
  });

  it("keeps demo usage visible when ChatGPT permission is required", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.health = { kind: "permission_required" };

    renderCockpit(state);

    expect(screen.getByText("Demo data")).toBeVisible();
    expect(screen.getByText("Permission required")).toBeVisible();
    expect(screen.getByText("72% used")).toBeVisible();
  });
});
