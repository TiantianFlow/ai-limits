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
      onRefreshProvider={vi.fn()}
      onAutoRefreshChange={vi.fn()}
      onDisconnectProvider={vi.fn()}
      onDeleteLocalData={vi.fn()}
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
    expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Claude" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Kimi" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Cursor" })).toBeVisible();
    expect(screen.getAllByText("Not connected")).toHaveLength(4);
    expect(screen.queryByText("Permission required")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Antigravity")).not.toBeInTheDocument();
  });

  it("renders connected quota pace and credits", () => {
    renderCockpit();

    expect(screen.getByText("ChatGPT")).toBeVisible();
    expect(screen.getByText("72% used")).toBeVisible();
    expect(screen.getAllByText("5 / 7 days elapsed")[0]).toBeVisible();
    expect(screen.getByText("$8.20 / $20.00 used")).toBeVisible();
    expect(screen.queryByText("Antigravity")).not.toBeInTheDocument();
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
        state={{
          ...state,
          preferences: { ...state.preferences, displayMode: "left" },
        }}
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

  it("shows refresh progress inside the existing global action", () => {
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        isRefreshing
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    const refresh = screen.getByRole("button", { name: "Refreshing usage" });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector(".refresh-spinner")).not.toBeNull();
    expect(screen.getByText("72% used")).toBeVisible();
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
    expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeVisible();
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

    const connect = screen.getByRole("button", { name: "Connect Claude" });
    expect(connect).toHaveTextContent("Connect");
    fireEvent.click(connect);
    expect(onConnectProvider).toHaveBeenCalledWith("claude");
  });

  it("renders a neutral not-connected state and disclosures before permission", () => {
    const state = createInitialState();

    renderCockpit(state);

    const chatGpt = screen.getByRole("article", { name: "ChatGPT" });
    expect(within(chatGpt).getByText("Not connected")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Connect ChatGPT" }),
    ).toBeVisible();
    expect(
      within(chatGpt).getByText(
        "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: "Kimi" })).getByText(
        "A manual refresh may briefly open an inactive Kimi tab.",
      ),
    ).toBeVisible();
  });

  it("removes redundant source and connection badges after collection", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.snapshot!.source = "web-session";

    renderCockpit(state);

    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect ChatGPT" }),
    ).not.toBeInTheDocument();
  });

  it("shows failed snapshot-free health in the padded empty state", () => {
    const state = createInitialState();
    state.providers[0]!.access = "granted";
    state.providers[0]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: {
        kind: "failure",
        category: "signed_out",
        message: "secret-bearing persisted message",
      },
    };

    renderCockpit(state);

    const card = screen.getByRole("article", { name: "ChatGPT" });
    const emptyState = card.querySelector(".provider-card__empty");
    expect(emptyState).not.toBeNull();
    expect(
      within(emptyState as HTMLElement).getByText(
        "Sign in to the provider and try again.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/secret-bearing/)).not.toBeInTheDocument();
    expect(screen.queryByText("72% used")).not.toBeInTheDocument();
  });

  it("marks data stale only after 35 minutes", () => {
    const state = createFixtureState(NOW);
    state.providers = [state.providers[0]!];
    state.providers[0]!.snapshot!.fetchedAt = NOW - 35 * 60 * 1_000;
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.getByText("Updated 35 minutes ago")).not.toHaveTextContent("Stale");

    view.rerender(
      <Cockpit
        state={state}
        now={NOW + 1}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(screen.getByText(/Stale · Updated 35 minutes ago/)).toBeVisible();
  });

  it("keeps a fresh scheduled Kimi session deferral quiet", () => {
    const state = createFixtureState(NOW);
    state.providers = [state.providers[2]!];
    state.providers[0]!.snapshot!.fetchedAt = NOW - 34 * 60 * 1_000;
    state.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 2_000,
      finishedAt: NOW - 1_000,
      outcome: { kind: "deferred", reason: "session_required" },
    };

    renderCockpit(state);

    expect(
      screen.queryByText("Auto-refresh is waiting for a Kimi session."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh Kimi" }),
    ).toBeVisible();
  });

  it("keeps a fresh scheduled temporary failure quiet but shows it once stale", () => {
    const state = createFixtureState(NOW);
    state.providers = [state.providers[0]!];
    state.providers[0]!.snapshot!.fetchedAt = NOW - 34 * 60 * 1_000;
    state.providers[0]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 2_000,
      finishedAt: NOW - 1_000,
      outcome: { kind: "failure", category: "temporary_error" },
    };

    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(
        "AI Limits could not refresh this provider. Try again later.",
      ),
    ).not.toBeInTheDocument();

    view.rerender(
      <Cockpit
        state={state}
        now={NOW + 60_001}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "AI Limits could not refresh this provider. Try again later.",
      ),
    ).toBeVisible();
  });

  it("offers provider-scoped refresh on every connected card", () => {
    const state = createFixtureState(NOW);
    const onRefreshProvider = vi.fn();
    render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onRefreshProvider={onRefreshProvider}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh Claude" }));
    expect(onRefreshProvider).toHaveBeenCalledWith("claude");
    expect(
      screen.getByRole("button", { name: "Refresh ChatGPT" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh Kimi" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Refresh Cursor" }),
    ).toBeVisible();
  });

  it("reveals an accessible history chart and current-window selector from each connected card", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.history.push({
      observedAt: NOW - 15 * 60 * 1_000,
      windows: [{ windowId: "retired-window", usedRatio: 0.9 }],
    });

    renderCockpit(state);

    expect(screen.getAllByRole("button", { name: "History" })).toHaveLength(4);
    const chatGpt = screen.getByRole("article", { name: "ChatGPT" });
    const historyButton = within(chatGpt).getByRole("button", {
      name: "History",
    });
    expect(historyButton).toHaveAttribute("aria-expanded", "false");
    expect(
      within(chatGpt).queryByRole("img", {
        name: /ChatGPT .* usage history/,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(historyButton);

    expect(historyButton).toHaveAttribute("aria-expanded", "true");
    const windowSelect = within(chatGpt).getByRole("combobox", {
      name: "Quota window",
    });
    expect(windowSelect).toBeVisible();
    expect(
      within(windowSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["5-hour messages", "Weekly messages"]);
    expect(
      within(windowSelect).queryByRole("option", {
        name: "retired-window",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(chatGpt).getByRole("img", {
        name: "ChatGPT 5-hour messages usage history",
      }),
    ).toBeVisible();
  });

  it("does not offer history without both provider access and a current snapshot", () => {
    const disconnected = createFixtureState(NOW);
    disconnected.providers = [
      { ...disconnected.providers[0]!, access: "required" },
    ];
    const firstView = render(
      <Cockpit
        state={disconnected}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "History" }),
    ).not.toBeInTheDocument();

    const snapshotFree = createInitialState();
    snapshotFree.providers = [
      { ...snapshotFree.providers[0]!, access: "granted" },
    ];
    firstView.rerender(
      <Cockpit
        state={snapshotFree}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "History" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["stale", true],
    ["empty", false],
  ])("offers a manual Kimi refresh for a %s scheduled deferral", (_label, hasSnapshot) => {
    const source = createFixtureState(NOW).providers[2]!;
    const provider = {
      ...source,
      ...(hasSnapshot
        ? {
            snapshot: {
              ...source.snapshot!,
              fetchedAt: NOW - 36 * 60 * 1_000,
            },
          }
        : { snapshot: undefined }),
      lastAttempt: {
        trigger: "scheduled" as const,
        startedAt: NOW - 2_000,
        finishedAt: NOW - 1_000,
        outcome: { kind: "deferred" as const, reason: "session_required" as const },
      },
    };
    const state: AppState = {
      ...createInitialState(),
      providers: [provider],
    };
    const onRefreshProvider = vi.fn();

    render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onRefreshProvider={onRefreshProvider}
      />,
    );

    expect(
      screen.getByText("Auto-refresh is waiting for a Kimi session."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Kimi" }));
    expect(onRefreshProvider).toHaveBeenCalledWith("kimi");
  });

  it("shows provider operations independently without hiding usage", () => {
    const state = createFixtureState(NOW);
    state.providers = [state.providers[2]!];

    render(
      <Cockpit
        state={state}
        now={NOW}
        providerOperations={{ kimi: "waiting_for_session" }}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for Kimi…")).toBeVisible();
    expect(screen.getByText("55% used")).toBeVisible();
  });

  it("suppresses Connect while any provider operation is active", () => {
    const state = createInitialState();

    render(
      <Cockpit
        state={state}
        now={NOW}
        providerOperations={{ chatgpt: "fetching" }}
        onDisplayModeChange={() => undefined}
        onRefresh={() => undefined}
        onConnectProvider={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Connect ChatGPT" }),
    ).not.toBeInTheDocument();
  });

  it("opens and closes a labelled in-panel provider manager", () => {
    renderCockpit();

    const settings = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(settings);

    const panel = screen.getByRole("region", { name: "Provider settings" });
    expect(panel).toBeVisible();
    expect(screen.queryByRole("region", { name: "AI provider usage" })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("region", { name: "Provider settings" })).not.toBeInTheDocument();
    expect(settings).toHaveFocus();
  });

  it("controls automatic refresh and connected-provider disconnects", () => {
    const onAutoRefreshChange = vi.fn();
    const onDisconnectProvider = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onAutoRefreshChange={onAutoRefreshChange}
        onDisconnectProvider={onDisconnectProvider}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    expect(autoRefresh).toBeChecked();
    fireEvent.click(autoRefresh);
    expect(onAutoRefreshChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    expect(onDisconnectProvider).toHaveBeenCalledWith("claude");
  });

  it("requires inline confirmation before deleting stored usage and disconnecting providers", () => {
    const onDeleteLocalData = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onDeleteLocalData={onDeleteLocalData}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));

    expect(onDeleteLocalData).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Confirm delete all local data" }),
    ).toHaveFocus();
    expect(
      screen.getByText("This removes stored usage and disconnects every provider."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel delete all local data" }));
    expect(
      screen.queryByRole("button", { name: "Confirm delete all local data" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete all local data" }));
    expect(onDeleteLocalData).toHaveBeenCalledTimes(1);
  });
});
