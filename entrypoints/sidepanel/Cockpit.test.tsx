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
import { Cockpit, providerView } from "./Cockpit";

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
  it.each([
    {
      name: "Provider Detail",
      announcement: "All providers updated.",
      open: () =>
        fireEvent.click(
          screen.getByRole("button", { name: "Open ChatGPT details" }),
        ),
      screenName: "ChatGPT detail",
    },
    {
      name: "History",
      announcement: "Kimi could not refresh. Try again.",
      open: () =>
        fireEvent.click(
          screen.getByRole("button", {
            name: "Open ChatGPT history for 5-hour messages",
          }),
        ),
      screenName: "ChatGPT history",
    },
    {
      name: "Settings",
      announcement: "All providers updated.",
      open: () =>
        fireEvent.click(screen.getByRole("button", { name: "Settings" })),
      screenName: "Provider settings",
    },
    {
      name: "Add Provider",
      announcement: "Kimi could not refresh. Try again.",
      open: () =>
        fireEvent.click(screen.getByRole("button", { name: "Add provider" })),
      screenName: "Add provider",
    },
  ])(
    "keeps a retained refresh announcement accessible without showing Overview chrome on $name",
    ({ announcement, open, screenName }) => {
      render(
        <Cockpit
          state={createFixtureState(NOW)}
          now={NOW}
          refreshAnnouncement={announcement}
          refreshAnnouncementId={7}
          onDisplayModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onConnectProvider={vi.fn()}
        />,
      );

      expect(screen.getByRole("status")).toBeVisible();
      open();

      const currentScreen = screen.getByRole("region", { name: screenName });
      expect(currentScreen).toBeVisible();
      expect(document.querySelector(".summary-bar")).not.toBeInTheDocument();
      expect(document.querySelector("main.cockpit")?.firstElementChild).toBe(
        currentScreen,
      );
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent(announcement);
      expect(screen.getByRole("status")).toHaveClass("visually-hidden");
    },
  );

  it("keeps a retained refresh announcement hidden behind First Run chrome", () => {
    render(
      <Cockpit
        state={createInitialState()}
        now={NOW}
        refreshAnnouncement="Kimi could not refresh. Try again."
        refreshAnnouncementId={8}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    const firstRun = screen.getByRole("region", {
      name: "Connect your providers",
    });
    expect(document.querySelector(".summary-bar")).not.toBeInTheDocument();
    expect(document.querySelector("main.cockpit")?.firstElementChild).toBe(
      firstRun,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kimi could not refresh. Try again.",
    );
    expect(screen.getByRole("status")).toHaveClass("visually-hidden");
  });

  it("carries provider-authored usage groups into the typed provider view", () => {
    const provider = createFixtureState(NOW).providers[0]!;
    provider.snapshot!.usageGroups = [
      {
        id: "priority",
        label: "Priority usage",
        description: "Provider-authored hierarchy.",
        windowIds: ["weekly"],
        creditIds: [],
      },
    ];

    expect(providerView(provider, "used", NOW).usageGroups).toEqual([
      {
        id: "priority",
        label: "Priority usage",
        description: "Provider-authored hierarchy.",
        quotas: [
          expect.objectContaining({ id: "weekly", label: "Weekly messages" }),
        ],
        credits: [],
      },
    ]);
  });

  it("renders quota rows through provider-authored semantic groups", () => {
    const state = createInitialState();
    const provider = createFixtureState(NOW).providers[0]!;
    provider.snapshot!.usageGroups = [
      {
        id: "short-term",
        label: "Short-term limits",
        windowIds: ["five-hour"],
        creditIds: [],
      },
      {
        id: "long-term",
        label: "Long-term limits",
        windowIds: ["weekly"],
        creditIds: [],
      },
    ];
    state.providers[0] = provider;

    renderCockpit(state);

    const shortTerm = screen.getByRole("region", {
      name: "Short-term limits",
    });
    const longTerm = screen.getByRole("region", {
      name: "Long-term limits",
    });
    expect(
      within(shortTerm).getByRole("group", { name: "5-hour messages" }),
    ).toBeVisible();
    expect(
      within(shortTerm).queryByRole("group", { name: "Weekly messages" }),
    ).not.toBeInTheDocument();
    expect(
      within(longTerm).getByRole("group", { name: "Weekly messages" }),
    ).toBeVisible();
  });

  it("renders one generic Usage group without embedded History and before the credits footer", () => {
    const state = createInitialState();
    const provider = createFixtureState(NOW).providers[0]!;
    delete provider.snapshot!.usageGroups;
    provider.snapshot!.credits = [
      {
        id: "credits",
        label: "Credits",
        unit: "credits",
        remaining: 414,
      },
    ];
    state.providers[0] = provider;

    renderCockpit(state);

    const card = screen.getByRole("article", { name: "ChatGPT" });
    const usage = within(card).getByRole("region", { name: "Usage" });
    const credits = within(card).getByRole("region", {
      name: "ChatGPT credits",
    });

    expect(
      within(usage).getByRole("group", { name: "5-hour messages" }),
    ).toBeVisible();
    expect(
      within(usage).getByRole("group", { name: "Weekly messages" }),
    ).toBeVisible();
    expect(
      usage.compareDocumentPosition(credits) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(card.querySelector(".history-disclosure")).not.toBeInTheDocument();
    expect(
      within(usage).getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    ).toBeVisible();
  });

  it("introduces First Run with every supported provider and no demo usage", () => {
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
    expect(
      screen.getByRole("heading", { name: "Connect your providers" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Claude" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Kimi" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Cursor" })).toBeVisible();
    expect(screen.queryByText("Permission required")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Antigravity")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "AI Limits" }),
    ).toBeVisible();
    expect(screen.getByText(/One panel for every AI subscription quota/)).toBeVisible();
    expect(screen.getByText("Supported providers · 4")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Refresh usage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("keeps the compact Connect surface inside a labelled action button", () => {
    renderCockpit(createInitialState());

    const connect = screen.getByRole("button", { name: "Connect ChatGPT" });
    const visualSurface = within(connect).getByText("Connect");

    expect(connect).toHaveAccessibleName("Connect ChatGPT");
    expect(connect.style.minHeight).toBe("44px");
    expect(visualSurface.tagName).toBe("SPAN");
    expect(visualSurface.style.height).toBe("32px");
    expect(visualSurface).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes distinct screen names and labelled return controls", () => {
    renderCockpit(createInitialState());
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Connect your providers",
      }),
    ).toBeVisible();
    cleanup();

    const state = createInitialState();
    state.providers[0] = createFixtureState(NOW).providers[0]!;

    renderCockpit(state);

    expect(
      screen.getByRole("heading", { level: 2, name: "Overview" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Overview" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Add provider" }),
    ).toBeVisible();
    expect(
      screen.getByText("Access is granted one provider at a time"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Overview" }),
    ).toHaveTextContent("Overview");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
    expect(
      screen.getByText("Everything here is local to this browser"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Overview" }),
    ).toHaveTextContent("Overview");
  });

  it("renders Provider Detail with grouped usage, recovery status, and connection management", () => {
    const state = createFixtureState(NOW);
    state.providers[1]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: NOW - 2_000,
      finishedAt: NOW - 1_000,
      outcome: { kind: "failure", category: "temporary_error" },
    };

    renderCockpit(state);
    fireEvent.click(screen.getByRole("button", { name: "Open Claude details" }));

    expect(screen.getByRole("heading", { level: 1, name: "Claude" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh Claude" })).toBeVisible();
    expect(screen.getByText("Showing last known values")).toBeVisible();
    expect(screen.getByText("AI Limits could not refresh this provider. Try again later.")).toBeVisible();

    const usage = screen.getByRole("region", { name: "Usage" });
    expect(within(usage).getByRole("heading", { name: "Usage" })).toBeVisible();
    expect(within(usage).getByText("$8.20 / $20.00 used")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Claude history" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Connection and capabilities" })).toBeVisible();
    expect(screen.getByText(/Reads usage from your signed-in browser session/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Manage Claude in Settings" })).toBeVisible();
  });

  it("renders History with compact selectors, ranges, a chart, and the current cycle", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.history.unshift({
      observedAt: NOW - 4 * 24 * 60 * 60 * 1_000,
      windows: [
        {
          windowId: "five-hour",
          usedRatio: 0.28,
          resetsAt: NOW - 4 * 24 * 60 * 60 * 1_000 + 2 * 60 * 60 * 1_000,
        },
      ],
    });

    renderCockpit(state);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );

    expect(screen.getByRole("heading", { level: 1, name: "ChatGPT history" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Quota window" })).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Show used or left" }),
    ).toBeVisible();
    const ranges = screen.getByRole("radiogroup", { name: "History range" });
    expect(within(ranges).getByRole("radio", { name: "48 hours" })).toBeVisible();
    expect(within(ranges).getByRole("radio", { name: "7 days" })).toBeVisible();
    expect(within(ranges).getByRole("radio", { name: "30 days" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Usage history chart" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Current cycle" })).toBeVisible();
    expect(screen.getByText(/Only successful, normalized quota observations are plotted/)).toBeVisible();
  });

  it("returns focus to the invoking Overview History control", () => {
    renderCockpit();

    const openHistory = screen.getByRole("button", {
      name: "Open ChatGPT history for 5-hour messages",
    });
    openHistory.focus();
    fireEvent.click(openHistory);

    expect(
      screen.getByRole("heading", { level: 1, name: "ChatGPT history" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    expect(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    ).toHaveFocus();
  });

  it("replaces Overview with Provider Detail and returns focus to the invoking control", () => {
    renderCockpit();

    const openProvider = screen.getByRole("button", {
      name: "Open ChatGPT details",
    });
    openProvider.focus();
    document.documentElement.scrollTop = 180;
    document.body.scrollTop = 180;
    fireEvent.click(openProvider);

    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(
      screen.getByRole("heading", { level: 1, name: "ChatGPT" }),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Overview" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "AI Limits" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    expect(screen.getByRole("region", { name: "Overview" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    ).toHaveFocus();
  });

  it("returns focus to the invoking Provider Detail quota History control", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    const openHistory = screen.getByRole("button", {
      name: "Open ChatGPT history for Weekly messages",
    });
    openHistory.focus();
    fireEvent.click(openHistory);

    expect(
      screen.getByRole("heading", { level: 1, name: "ChatGPT history" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));

    expect(
      screen.getByRole("button", {
        name: "Open ChatGPT history for Weekly messages",
      }),
    ).toHaveFocus();
  });

  it("lets an explicit Provider Detail history route override a saved window", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Quota window" }), {
      target: { value: "weekly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT history" }),
    );

    expect(
      screen.getByRole("combobox", { name: "Quota window" }),
    ).toHaveValue("five-hour");
  });

  it("opens the exact quota window named by an Overview History affordance", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for Weekly messages",
      }),
    );

    expect(
      screen.getByRole("combobox", { name: "Quota window" }),
    ).toHaveValue("weekly");
  });

  it("restores independent saved windows when switching history providers", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    const providerSelect = screen.getByRole("combobox", {
      name: "History provider",
    });
    const windowSelect = screen.getByRole("combobox", { name: "Quota window" });

    fireEvent.change(windowSelect, { target: { value: "weekly" } });
    fireEvent.change(providerSelect, { target: { value: "kimi" } });
    expect(windowSelect).toHaveValue("five-hour");
    fireEvent.change(windowSelect, { target: { value: "weekly" } });

    fireEvent.change(providerSelect, { target: { value: "chatgpt" } });
    expect(windowSelect).toHaveValue("weekly");
    fireEvent.change(providerSelect, { target: { value: "kimi" } });
    expect(windowSelect).toHaveValue("weekly");
  });

  it("lets an explicit Overview window override that provider's saved selection", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Quota window" }), {
      target: { value: "weekly" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "History provider" }),
      { target: { value: "claude" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );

    expect(
      screen.getByRole("combobox", { name: "History provider" }),
    ).toHaveValue("chatgpt");
    expect(
      screen.getByRole("combobox", { name: "Quota window" }),
    ).toHaveValue("five-hour");
  });

  it("falls back to the first current window when a saved window is no longer valid", () => {
    const state = createFixtureState(NOW);
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Quota window" }), {
      target: { value: "weekly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    view.rerender(
      <Cockpit
        state={{
          ...state,
          providers: state.providers.map((provider) =>
            provider.providerId === "chatgpt" && provider.snapshot
              ? {
                  ...provider,
                  snapshot: {
                    ...provider.snapshot,
                    windows: [provider.snapshot.windows[0]!],
                  },
                }
              : provider,
          ),
        }}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    expect(
      screen.getByRole("combobox", { name: "Quota window" }),
    ).toHaveValue("five-hour");
  });

  it("returns from Settings to the Provider that invoked it", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    const settings = screen.getByRole("button", { name: "Settings" });
    settings.focus();
    fireEvent.click(settings);

    expect(
      screen.getByRole("region", { name: "Provider settings" }),
    ).toBeVisible();
    expect(screen.queryByRole("article", { name: "ChatGPT" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));

    expect(screen.getByRole("article", { name: "ChatGPT" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
  });

  it("shows a truthful unavailable screen if the active provider disconnects", () => {
    const state = createFixtureState(NOW);
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );

    view.rerender(
      <Cockpit
        state={{
          ...state,
          providers: state.providers.map((provider) =>
            provider.providerId === "chatgpt"
              ? { ...provider, access: "required" }
              : provider,
          ),
        }}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Provider unavailable" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Refresh ChatGPT" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Return to Overview" }),
    ).toBeVisible();
  });

  it("shows only connected providers on Overview and opens Add Provider", () => {
    const state = createInitialState();
    state.providers[0] = createFixtureState(NOW).providers[0]!;

    renderCockpit(state);

    expect(screen.getByRole("article", { name: "ChatGPT" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "Claude" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Kimi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Cursor" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    expect(screen.getByRole("heading", { name: "Add provider" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect ChatGPT" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Claude" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Kimi" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Cursor" })).toBeVisible();
    expect(screen.getAllByText(/^Can show:/)).toHaveLength(3);
    expect(screen.getByText(/Connect asks for permission for that provider only/)).toBeVisible();
  });

  it("shows an honest Add Provider empty state when all providers are connected", () => {
    renderCockpit();

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    expect(screen.getByText("All supported providers are connected.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Connect / })).not.toBeInTheDocument();
  });

  it("keeps connect actions provider-scoped and disables only the active provider", () => {
    const onConnectProvider = vi.fn();

    render(
      <Cockpit
        state={createInitialState()}
        now={NOW}
        providerOperations={{ chatgpt: "requesting_permission" }}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={onConnectProvider}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeDisabled();
    const claudeConnect = screen.getByRole("button", { name: "Connect Claude" });
    expect(claudeConnect).toBeEnabled();

    fireEvent.click(claudeConnect);
    expect(onConnectProvider).toHaveBeenCalledWith("claude");
    expect(onConnectProvider).not.toHaveBeenCalledWith("chatgpt");
  });

  it("restores focus to the invoker after Back from Add Provider", () => {
    const state = createInitialState();
    state.providers[0] = createFixtureState(NOW).providers[0]!;

    renderCockpit(state);

    const addProvider = screen.getByRole("button", { name: "Add provider" });
    addProvider.focus();
    fireEvent.click(addProvider);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    expect(screen.getByRole("button", { name: "Add provider" })).toHaveFocus();
  });

  it("opens Add Provider from Settings and restores focus to its remounted invoker", () => {
    const state = createInitialState();
    state.providers[0] = createFixtureState(NOW).providers[0]!;

    renderCockpit(state);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const settingsAddProvider = screen.getByRole("button", {
      name: "Add provider",
    });
    settingsAddProvider.focus();
    fireEvent.click(settingsAddProvider);

    expect(screen.getByRole("heading", { name: "Add provider" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connect ChatGPT" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Claude" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Kimi" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Cursor" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(
      screen.getByRole("region", { name: "Provider settings" }),
    ).toBeVisible();
    const remountedSettingsAddProvider = screen.getByRole("button", {
      name: "Add provider",
    });
    expect(remountedSettingsAddProvider).not.toBe(settingsAddProvider);
    expect(remountedSettingsAddProvider).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("region", { name: "Overview" })).toBeVisible();
  });

  it("shows Kimi's credential and interactive-tab disclosure on First Run and Add Provider", () => {
    const connectionDisclosure =
      "With permission, AI Limits may read the exact value of Kimi's signed-in kimi-auth cookie or the page's localStorage.access_token on kimi.com. It stores normalized usage locally, not the credential.";
    const recoveryDisclosure =
      "Connect and manual Refresh may briefly open one inactive Kimi tab when recovery is needed. Scheduled or automatic refresh never opens a tab.";

    renderCockpit(createInitialState());
    let kimi = screen.getByRole("article", { name: "Kimi" });
    expect(within(kimi).getByText(connectionDisclosure)).toBeVisible();
    expect(within(kimi).getByText(recoveryDisclosure)).toBeVisible();
    cleanup();

    const state = createInitialState();
    state.providers[0] = createFixtureState(NOW).providers[0]!;
    renderCockpit(state);
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    kimi = screen.getByRole("article", { name: "Kimi" });
    expect(within(kimi).getByText(connectionDisclosure)).toBeVisible();
    expect(within(kimi).getByText(recoveryDisclosure)).toBeVisible();
  });

  it("renders connected quota pace and credits", () => {
    renderCockpit();

    expect(screen.getByText("ChatGPT")).toBeVisible();
    expect(screen.getByText("72% used")).toBeVisible();
    expect(screen.getAllByText("5 / 7 days elapsed")[0]).toBeVisible();
    expect(screen.getByText("$8.20 / $20.00 used")).toBeVisible();
    expect(screen.queryByText("Antigravity")).not.toBeInTheDocument();
  });

  it("renders the approved compact Overview anatomy on production data", () => {
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        refreshAnnouncement="Updated 4 providers."
        refreshAnnouncementId={1}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    const overview = screen.getByRole("region", { name: "Overview" });
    const appHeader = document.querySelector<HTMLElement>(".app-header");
    expect(appHeader).not.toBeNull();
    expect(appHeader).toHaveClass("app-header");
    expect(appHeader).toHaveClass("app-header--compact");
    expect(
      screen.queryByRole("heading", { level: 1, name: "AI Limits" }),
    ).not.toBeInTheDocument();
    expect(
      within(appHeader as HTMLElement).getByRole("radiogroup", {
        name: "Show used or left",
      }),
    ).toBeVisible();
    expect(
      within(appHeader as HTMLElement).getByText(
        "Last refresh just now · 4 providers",
      ),
    ).toBeVisible();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Updated 4 providers.");

    const chatGpt = within(overview).getByRole("article", { name: "ChatGPT" });
    expect(within(chatGpt).getByText("Updated just now")).toBeVisible();
    expect(
      within(chatGpt).getByRole("button", { name: "Open ChatGPT details" }),
    ).toBeVisible();
    const providerRefresh = within(chatGpt).getByRole("button", {
      name: "Refresh ChatGPT",
    });
    expect(providerRefresh).toHaveTextContent("");
    expect(
      within(chatGpt).getByRole("button", {
        name: "Open ChatGPT history for Weekly messages",
      }),
    ).toBeVisible();
    expect(within(chatGpt).getAllByRole("meter")).toHaveLength(4);
    expect(chatGpt.querySelector(".history-disclosure")).not.toBeInTheDocument();
    expect(
      within(chatGpt).queryByRole("button", { name: /^Refresh$/ }),
    ).not.toBeInTheDocument();

    const addProvider = within(overview).getByRole("button", {
      name: "Add provider",
    });
    expect(addProvider).toHaveClass("add-provider-action");
    expect(screen.getByRole("heading", { name: "Built in the open" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View source" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Share feedback" })).toBeVisible();
    const footerMark = document.querySelector<HTMLImageElement>(
      '.open-source-footer img[src="/provider-marks/github.svg"]',
    );
    expect(footerMark).toHaveClass("open-source-footer__mark");
    expect(footerMark).not.toHaveClass("local-mark-tile", "mark-contrast-tile");
    const settings = within(appHeader as HTMLElement).getByRole("button", {
      name: "Settings",
    });
    expect(settings).toHaveAccessibleName("Settings");
    expect(
      settings.querySelector("path")?.getAttribute("d")?.trim(),
    ).toMatch(/[zZ]$/);
    expect(
      within(appHeader as HTMLElement)
        .getByRole("radio", { name: "Used" })
        .querySelector(".segmented-control__option"),
    ).not.toBeNull();
    expect(settings.querySelector(".control-surface")).not.toBeNull();
  });

  it("formats the known ChatGPT plan value at the display boundary", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.snapshot!.planLabel = "plus";

    renderCockpit(state);

    const chatGpt = within(screen.getByRole("article", { name: "ChatGPT" }));
    expect(chatGpt.getByText("Plus")).toBeVisible();
    expect(chatGpt.queryByText("plus")).not.toBeInTheDocument();
  });

  it("describes pace deltas as over or under pace", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.snapshot!.windows[1]!.usedRatio = 0.5;

    renderCockpit(state);

    expect(screen.getByText("12 pts over pace")).toBeVisible();
    expect(screen.getByText("21 pts under pace")).toBeVisible();
    expect(screen.queryByText(/points? ahead|points? behind/)).not.toBeInTheDocument();
  });

  it("shows the most recent finished attempt in the idle header", () => {
    const state = createFixtureState(NOW);
    state.providers.forEach((provider) => {
      provider.snapshot!.fetchedAt = NOW - 10 * 60 * 1_000;
    });
    state.providers[1]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 3 * 60 * 1_000 - 2_000,
      finishedAt: NOW - 3 * 60 * 1_000,
      outcome: { kind: "success" },
    };

    renderCockpit(state);

    expect(
      screen.getByText("Last refresh 3 minutes ago · 4 providers"),
    ).toBeVisible();
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

    expect(screen.getByText("414 remaining")).toBeVisible();

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
    expect(screen.getByText("414 remaining")).toBeVisible();
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
    const pace = weekly.getByText(/pts (over|under) pace|On pace/).textContent;

    expect(
      weekly.getByRole("meter", { name: "Weekly messages time elapsed" }),
    ).toHaveAttribute("aria-valuenow", "71.4286");
    expect(weekly.getByText("5 / 7 days elapsed")).toBeVisible();

    const reset = weekly.getByText(/^Resets /);
    expect(reset.tagName).toBe("TIME");
    expect(reset).toHaveAttribute(
      "datetime",
      new Date(state.providers[0]!.snapshot!.windows[1]!.resetsAt!).toISOString(),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Left" }));
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
      remainingWeekly.getByRole("meter", {
        name: "Weekly messages time remaining",
      }),
    ).toHaveAttribute("aria-valuenow", "28.5714");
    expect(remainingWeekly.getByText("2 / 7 days remaining")).toBeVisible();
    expect(remainingWeekly.getByText(pace!)).toBeVisible();
  });

  it("keeps the display selector with the global header actions", () => {
    renderCockpit();

    const header = document.querySelector<HTMLElement>(".app-header");
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole("radiogroup", {
        name: "Show used or left",
      }),
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
    expect(refresh.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Refreshing providers…")).toBeVisible();
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
      within(quotaGroup).getByRole("meter", {
        name: "5-hour messages quota used",
      }),
    ).toBeVisible();
    expect(
      within(quotaGroup).queryByRole("meter", {
        name: "5-hour messages time elapsed",
      }),
    ).not.toBeInTheDocument();
  });

  it("labels all icon actions for assistive technology", () => {
    renderCockpit();

    expect(screen.getByRole("button", { name: "Refresh usage" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh ChatGPT" })).toBeVisible();
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
        "Connect and manual Refresh may briefly open one inactive Kimi tab when recovery is needed. Scheduled or automatic refresh never opens a tab.",
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
    expect(within(card).getByText("Needs attention")).toBeVisible();
    expect(within(card).queryByText("Current")).not.toBeInTheDocument();
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
      screen.queryByText(
        "Automatic refresh couldn't update Kimi. Manual Refresh may briefly open an inactive Kimi tab.",
      ),
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

  it("opens an accessible dedicated history screen from each connected card", () => {
    const state = createFixtureState(NOW);
    state.providers[0]!.history.push({
      observedAt: NOW - 15 * 60 * 1_000,
      windows: [{ windowId: "retired-window", usedRatio: 0.9 }],
    });

    renderCockpit(state);

    expect(
      screen.getAllByRole("button", { name: /^Open .* history for / }),
    ).toHaveLength(6);
    const chatGpt = screen.getByRole("article", { name: "ChatGPT" });
    const historyButton = within(chatGpt).getByRole("button", {
      name: "Open ChatGPT history for 5-hour messages",
    });
    expect(
      within(chatGpt).queryByRole("img", {
        name: /ChatGPT .* usage history/,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(historyButton);

    expect(screen.queryByRole("article", { name: "ChatGPT" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Overview" }),
    ).toBeVisible();
    const windowSelect = screen.getByRole("combobox", {
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
      screen.getByRole("img", {
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
      screen.queryByRole("button", { name: /^Open ChatGPT history/ }),
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
      screen.queryByRole("button", { name: /^Open ChatGPT history/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    expect(
      screen.queryByRole("button", { name: /^Open ChatGPT history/ }),
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
      screen.getByText(
        "Automatic refresh couldn't update Kimi. Manual Refresh may briefly open an inactive Kimi tab.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Kimi" }));
    expect(onRefreshProvider).toHaveBeenCalledWith("kimi");
  });

  it("hides only an active provider's refresh without hiding usage", () => {
    const state = createFixtureState(NOW);
    state.providers = [state.providers[0]!, state.providers[2]!];

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

    const waiting = screen.getByText("Waiting for Kimi…");
    expect(waiting).toBeVisible();
    expect(waiting.closest(".status-chip")).toHaveClass(
      "status-chip--attention",
    );
    expect(screen.getByText("55% used")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Refresh Kimi" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh ChatGPT" }),
    ).toBeVisible();
  });

  it("disables Connect while that provider operation is active", () => {
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
      screen.getByRole("button", { name: "Connect ChatGPT" }),
    ).toBeDisabled();
  });

  it("opens and closes a labelled in-panel provider manager", () => {
    renderCockpit();

    const settings = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(settings);

    const panel = screen.getByRole("region", { name: "Provider settings" });
    expect(panel).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Overview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Overview" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Overview" }));
    expect(screen.queryByRole("region", { name: "Provider settings" })).not.toBeInTheDocument();
    const remountedSettings = screen.getByRole("button", { name: "Settings" });
    expect(remountedSettings).not.toBe(settings);
    expect(remountedSettings).toHaveFocus();
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
    expect(autoRefresh.closest(".settings-toggle__control")).not.toBeNull();
    expect(
      autoRefresh.parentElement?.querySelector(".settings-toggle__track"),
    ).not.toBeNull();
    fireEvent.click(autoRefresh);
    expect(onAutoRefreshChange).toHaveBeenCalledWith(false);

    const claudeRow = screen.getByRole("listitem", { name: "Claude settings" });
    expect(
      claudeRow.querySelector('img[src="/provider-marks/claude.svg"]'),
    ).not.toBeNull();
    expect(within(claudeRow).getByText(/refreshes about every 15 minutes/)).toBeVisible();
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
    const deleteTrigger = screen.getByRole("button", { name: "Delete all local data" });
    deleteTrigger.focus();
    fireEvent.click(deleteTrigger);

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
    expect(screen.getByRole("button", { name: "Delete all local data" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete all local data" }));
    expect(onDeleteLocalData).toHaveBeenCalledTimes(1);
  });

  it("exposes safe community links and the secret warning on Overview and Settings", () => {
    renderCockpit();

    const repository = screen.getByRole("link", { name: "View source" });
    const issues = screen.getByRole("link", {
      name: "Share feedback",
    });
    expect(repository).toHaveAttribute("href", "https://github.com/TiantianFlow/ai-limits");
    expect(issues).toHaveAttribute("href", "https://github.com/TiantianFlow/ai-limits/issues");
    for (const link of [repository, issues]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    }
    expect(
      screen.getByText(
        "Do not include cookies, access credentials, private usage data, or other secrets in an issue.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(
      screen.getByRole("link", { name: "View source" }),
    ).toHaveAttribute("href", "https://github.com/TiantianFlow/ai-limits");
    expect(
      screen.getByRole("link", {
        name: "Share feedback",
      }),
    ).toHaveAttribute("href", "https://github.com/TiantianFlow/ai-limits/issues");
    expect(
      screen.getByText(
        "Do not include cookies, access credentials, private usage data, or other secrets in an issue.",
      ),
    ).toBeVisible();
  });

  it("renders local provider marks beside names with Provider Detail navigation", () => {
    renderCockpit();

    const chatGpt = screen.getByRole("article", { name: "ChatGPT" });
    const heading = within(chatGpt).getByRole("heading", { name: "ChatGPT" });
    const identity = heading.closest(".provider-card__identity");
    expect(identity).not.toBeNull();
    expect(identity?.querySelector('img[src="/provider-marks/chatgpt.svg"]')).not.toBeNull();
    const localMarks = Array.from(
      document.querySelectorAll<HTMLImageElement>("img.provider-mark"),
    );
    expect(localMarks).toHaveLength(4);
    expect(
      localMarks.every((mark) => mark.classList.contains("provider-mark")),
    ).toBe(true);
    expect(
      localMarks.some((mark) => mark.classList.contains("local-mark-tile")),
    ).toBe(false);
    expect(
      localMarks.some((mark) => mark.classList.contains("mark-contrast-tile")),
    ).toBe(false);
    expect(within(chatGpt).queryByRole("link", { name: /detail/i })).not.toBeInTheDocument();
    expect(
      within(chatGpt).getByRole("button", { name: "Open ChatGPT details" }),
    ).toBeVisible();
  });
});
