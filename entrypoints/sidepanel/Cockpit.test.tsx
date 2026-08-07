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
});
