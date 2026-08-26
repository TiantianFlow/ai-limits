import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderKind } from "../../domain/model";
import type {
  AppViewState,
  ProviderInstanceView,
  ProviderOperation,
} from "../../domain/public-protocol";
import {
  createEmptyFixtureState,
  createFixtureState,
} from "../../providers/fixtures";
import {
  isApiKeyProviderKind,
  providerKinds,
  providerNames,
  providerPresentation,
} from "../../providers/catalog";
import {
  Cockpit as InstanceCockpit,
  providerView as instanceProviderView,
} from "./Cockpit";

const NOW = Date.UTC(2026, 7, 7, 16);
const PERSONAL_NEW_API_ID =
  "newapi:11111111-1111-4111-8111-111111111111";
const WORK_NEW_API_ID =
  "newapi:22222222-2222-4222-8222-222222222222";

afterEach(cleanup);

function toInstance(
  provider: ProviderInstanceView,
): ProviderInstanceView {
  const snapshot = provider.snapshot
    ? (() => {
        const { accountLabel: _accountLabel, ...rest } = provider.snapshot;
        return rest;
      })()
    : undefined;
  return {
    ...provider,
    ...(snapshot ? { snapshot } : {}),
  };
}

function toViewState(state: AppViewState): AppViewState {
  return {
    preferences: state.preferences,
    providers: state.providers,
    instances: state.instances.map(toInstance),
  };
}

type TestCockpitProps = Omit<
  React.ComponentProps<typeof InstanceCockpit>,
  "state" | "providerOperations" | "onSubmitApiKey"
> & {
  state: AppViewState;
  providerOperations?: Partial<Record<ProviderKind | string, ProviderOperation>>;
  onRefreshProvider?: (providerId: ProviderKind) => void;
  onDisconnectProvider?: (providerId: ProviderKind) => void;
  onSubmitApiKey?: (
    providerId: ProviderKind,
    apiKey: string,
    baseUrl?: string,
  ) => Promise<"connected" | "invalid_key" | "insufficient_scope" | "invalid_site" | "temporary_error" | "permission_declined">;
};

function Cockpit({
  state,
  providerOperations,
  onRefreshProvider,
  onDisconnectProvider,
  onSubmitApiKey,
  ...props
}: TestCockpitProps) {
  return (
    <InstanceCockpit
      {...props}
      state={toViewState(state)}
      providerOperations={Object.fromEntries(
        Object.entries(providerOperations ?? {}).map(([key, operation]) => [
          key.includes(":") ? key : `${key}:default`,
          operation,
        ]),
      )}
      onRefreshInstance={
        props.onRefreshInstance ??
        (onRefreshProvider
          ? (instanceId) =>
              onRefreshProvider(instanceId.slice(0, instanceId.indexOf(":")) as ProviderKind)
          : undefined)
      }
      onDisconnectInstance={
        props.onDisconnectInstance ??
        (onDisconnectProvider
          ? (instanceId) =>
              onDisconnectProvider(instanceId.slice(0, instanceId.indexOf(":")) as ProviderKind)
          : undefined)
      }
      onSubmitApiKey={
        onSubmitApiKey
          ? (submission) =>
              onSubmitApiKey(
                submission.providerKind,
                submission.apiKey,
                submission.baseUrl,
              )
          : undefined
      }
    />
  );
}

function providerView(
  provider: ProviderInstanceView,
  mode: AppViewState["preferences"]["displayMode"],
  now: number,
) {
  return instanceProviderView(toInstance(provider), mode, now);
}

function renderCockpit(
  state: AppViewState = createFixtureState(NOW),
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

function windowCombobox() {
  return screen.getByRole("combobox", { name: "Window" });
}

function chooseWindow(label: string) {
  fireEvent.click(windowCombobox());
  fireEvent.click(screen.getByRole("option", { name: label }));
}

function expectWindow(label: string) {
  const combobox = windowCombobox();
  // The native select is gone: the Window control is a custom
  // trigger-aligned listbox popover built on a button trigger.
  expect(combobox.tagName).toBe("BUTTON");
  expect(combobox).toHaveTextContent(label);
}

function twoNewApiInstances(): AppViewState {
  const metrics = [
    {
      type: "quota" as const,
      id: "relay-key-quota",
      label: "API key quota",
      scope: "feature" as const,
      usedRatio: 0.2,
    },
    {
      type: "quota" as const,
      id: "daily-relay-quota",
      label: "Daily relay quota",
      scope: "feature" as const,
      usedRatio: 0.6,
    },
  ];
  return {
    preferences: { displayMode: "used", autoRefresh: true },
    providers: createEmptyFixtureState().providers,
    instances: [
      {
        id: PERSONAL_NEW_API_ID,
        providerKind: "newapi",
        userLabel: "Personal relay",
        baseUrl: "https://relay.example",
        origin: "https://relay.example",
        access: "granted",
        createdAt: NOW - 2_000,
        history: [],
        snapshot: {
          providerKind: "newapi",
          source: "api-key",
          fetchedAt: NOW,
          metrics,
        },
      },
      {
        id: WORK_NEW_API_ID,
        providerKind: "newapi",
        userLabel: "Work relay",
        baseUrl: "https://relay.example",
        origin: "https://relay.example",
        access: "granted",
        createdAt: NOW - 1_000,
        history: [],
        snapshot: {
          providerKind: "newapi",
          source: "api-key",
          fetchedAt: NOW,
          metrics: metrics.map((metric) => ({
            ...metric,
            usedRatio: metric.usedRatio + 0.1,
          })),
        },
      },
    ],
  };
}

describe("Cockpit", () => {
  it("renders and operates same-origin New API instances by instance identity", () => {
    const onRefreshInstance = vi.fn();
    const state = twoNewApiInstances();

    render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onRefreshInstance={onRefreshInstance}
      />,
    );

    expect(screen.getByText("Personal relay")).toBeVisible();
    expect(screen.getByText("Work relay")).toBeVisible();
    expect(
      screen.getByRole("article", { name: "New API Personal relay" }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", { name: "New API Work relay" }),
    ).toBeVisible();
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    const personalRefresh = screen.getByRole("button", {
      name: "Refresh Personal relay",
    });
    const workRefresh = screen.getByRole("button", {
      name: "Refresh Work relay",
    });
    expect(personalRefresh).toHaveAttribute(
      "data-focus-key",
      `overview-refresh-${PERSONAL_NEW_API_ID}`,
    );
    expect(workRefresh).toHaveAttribute(
      "data-focus-key",
      `overview-refresh-${WORK_NEW_API_ID}`,
    );

    fireEvent.click(personalRefresh);
    expect(onRefreshInstance).toHaveBeenCalledWith(
      PERSONAL_NEW_API_ID,
    );
    expect(onRefreshInstance).not.toHaveBeenCalledWith(
      WORK_NEW_API_ID,
    );

    const personalDetails = screen.getByRole("button", {
      name: "Open Personal relay details",
    });
    personalDetails.focus();
    fireEvent.click(personalDetails);
    expect(
      screen.getByRole("region", { name: "Personal relay detail" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(
      screen.getByRole("button", { name: "Open Personal relay details" }),
    ).toHaveFocus();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Work relay details" }),
    );
    expect(
      screen.getByRole("region", { name: "Work relay detail" }),
    ).toBeVisible();
  });

  it("stably disambiguates blank same-origin fallbacks everywhere by short instance ID", () => {
    const state = twoNewApiInstances();
    delete state.instances[0]!.userLabel;
    delete state.instances[1]!.userLabel;
    const view = render(
      <InstanceCockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    const personalLabel = "relay.example · 11111111";
    const workLabel = "relay.example · 22222222";

    expect(
      screen.getByRole("article", { name: `New API ${personalLabel}` }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", { name: `New API ${workLabel}` }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Refresh ${personalLabel}` }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Open ${personalLabel} details`,
      }),
    );
    expect(
      screen.getByRole("region", { name: `${personalLabel} detail` }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: personalLabel, level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Refresh ${personalLabel}` }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Open ${personalLabel} history for API key quota`,
      }),
    );
    expect(
      screen.queryByRole("combobox", { name: "History provider" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: `${personalLabel} history` }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("heading", { name: `New API · ${personalLabel}` }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Disconnect ${workLabel}` }),
    ).toBeVisible();

    view.rerender(
      <InstanceCockpit
        state={{ ...state, instances: [...state.instances].reverse() }}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: `Rename ${personalLabel}` }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Disconnect ${workLabel}` }),
    ).toBeVisible();
  });

  it("keeps same-kind operations and the routed History provider fixed", () => {
    render(
      <InstanceCockpit
        state={twoNewApiInstances()}
        now={NOW}
        providerOperations={{ [PERSONAL_NEW_API_ID]: "fetching" }}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    const personalCard = screen.getByRole("article", {
      name: "New API Personal relay",
    });
    const workCard = screen.getByRole("article", {
      name: "New API Work relay",
    });
    expect(within(personalCard).getByText("Fetching usage…")).toBeVisible();
    expect(
      within(personalCard).queryByRole("button", { name: "Refresh Personal relay" }),
    ).not.toBeInTheDocument();
    expect(
      within(workCard).getByRole("button", { name: "Refresh Work relay" }),
    ).toBeVisible();

    fireEvent.click(
      within(workCard).getByRole("button", {
        name: "Open Work relay history for API key quota",
      }),
    );
    expect(
      screen.queryByRole("combobox", { name: "History provider" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Work relay history" }),
    ).toBeVisible();
    chooseWindow("Daily relay quota");
    expectWindow("Daily relay quota");
  });

  it("targets exact same-kind Settings actions and restores rename focus", async () => {
    const onDisconnectInstance = vi.fn();
    const onRenameInstance = vi.fn(async () => true);
    const onSubmitApiKey = vi.fn(async () => "invalid_key" as const);
    render(
      <InstanceCockpit
        state={twoNewApiInstances()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onDisconnectInstance={onDisconnectInstance}
        onRenameInstance={onRenameInstance}
        onSubmitApiKey={onSubmitApiKey}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("heading", { name: "New API · Personal relay" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "New API · Work relay" }),
    ).toBeVisible();
    const personalRename = screen.getByRole("button", {
      name: "Rename Personal relay",
    });
    personalRename.focus();
    fireEvent.click(personalRename);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel renaming Personal relay" }),
    );
    expect(
      screen.getByRole("button", { name: "Rename Personal relay" }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Rename Work relay" }));
    fireEvent.change(screen.getByLabelText("Instance label"), {
      target: { value: "   " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save label for Work relay" }),
    );
    expect(onRenameInstance).toHaveBeenCalledWith(WORK_NEW_API_ID, undefined);
    expect(onRenameInstance).not.toHaveBeenCalledWith(PERSONAL_NEW_API_ID, undefined);

    fireEvent.click(
      screen.getByRole("button", { name: "Replace Work relay API key" }),
    );
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & replace" }));
    await waitFor(() =>
      expect(onSubmitApiKey).toHaveBeenCalledWith({
        providerKind: "newapi",
        instanceId: WORK_NEW_API_ID,
        userLabel: "Work relay",
        baseUrl: "https://relay.example",
        apiKey: "replacement",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Work relay" }));
    expect(onDisconnectInstance).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm disconnect Work relay" }),
    );
    expect(onDisconnectInstance).toHaveBeenCalledWith(WORK_NEW_API_ID);
    expect(onDisconnectInstance).not.toHaveBeenCalledWith(PERSONAL_NEW_API_ID);
  });

  it("keeps the rename editor pending until success and restores focus afterward", async () => {
    let finishRename: ((value: boolean) => void) | undefined;
    const onRenameInstance = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRename = resolve;
        }),
    );
    render(
      <InstanceCockpit
        state={twoNewApiInstances()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onRenameInstance={onRenameInstance}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Work relay" }));
    const input = screen.getByLabelText("Instance label");
    fireEvent.change(input, { target: { value: "Focused relay" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save label for Work relay" }),
    );

    expect(onRenameInstance).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Focused relay");
    expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save label for Work relay" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Renaming…");
    expect(
      screen.queryByRole("button", { name: "Rename Work relay" }),
    ).not.toBeInTheDocument();

    await act(async () => finishRename?.(true));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rename Work relay" }),
      ).toHaveFocus(),
    );
  });

  it("keeps a failed rename draft and shows only sanitized inline feedback", async () => {
    let failRename: ((error: Error) => void) | undefined;
    const onRenameInstance = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          failRename = reject;
        }),
    );
    render(
      <InstanceCockpit
        state={twoNewApiInstances()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onRenameInstance={onRenameInstance}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Work relay" }));
    const input = screen.getByLabelText("Instance label");
    fireEvent.change(input, { target: { value: "Still here" } });
    const save = screen.getByRole("button", {
      name: "Save label for Work relay",
    });
    save.focus();
    fireEvent.click(save);

    expect(save).toBeDisabled();
    expect(onRenameInstance).toHaveBeenCalledTimes(1);
    await act(async () => failRename?.(new Error("secret backend detail")));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t rename this connection. Try again.",
    );
    expect(input).toHaveValue("Still here");
    expect(input).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Save label for Work relay" }),
    ).toBeEnabled();
    expect(input).toHaveFocus();
    expect(document.body).not.toHaveTextContent("secret backend detail");
    expect(
      screen.queryByRole("button", { name: "Rename Work relay" }),
    ).not.toBeInTheDocument();
  });

  it("renders unlimited New API usage without offering quota history", () => {
    const state = createEmptyFixtureState();
    state.instances[0] = {
      id: "newapi:default",
      providerKind: "newapi",
      userLabel: "New API",
      baseUrl: "https://relay.example",
      origin: "https://relay.example",
      access: "granted",
      createdAt: NOW,
      history: [],
      snapshot: {
        providerKind: "newapi",
        planLabel: "Unlimited",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "counter",
            id: "relay-key-usage",
            label: "API key usage",
            scope: "feature",
            semantic: "consumed",
            value: 42_000,
            unit: "quota units",
          },
        ],
      },
    };

    renderCockpit(state);
    expect(screen.getByText("42,000 quota units used")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open New API details" }));

    const detail = screen.getByRole("region", { name: "New API detail" });
    expect(within(detail).getByText("42,000 quota units used")).toBeVisible();
    expect(
      within(detail).queryByRole("button", { name: "Open New API history" }),
    ).not.toBeInTheDocument();
  });

  it("renders counter and balance metrics on Overview and Detail but offers only quotas in History", () => {
    const state = createEmptyFixtureState();
    state.instances[0] = {
      id: "chatgpt:default",
      providerKind: "chatgpt",
      access: "granted",
      createdAt: NOW,
      history: [],
      snapshot: {
        providerKind: "chatgpt",
        source: "web-session",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "weekly",
            label: "Weekly messages",
            scope: "general",
            usedRatio: 0.4,
          },
          {
            type: "counter",
            id: "extra-usage",
            label: "Extra usage",
            scope: "product",
            semantic: "spent",
            value: 12.5,
            unit: "USD",
            limit: 50,
          },
          {
            type: "balance",
            id: "credits",
            label: "Credits",
            scope: "product",
            value: 414,
            unit: "credits",
          },
        ],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["weekly", "extra-usage", "credits"],
          },
        ],
      },
    };

    renderCockpit(state);

    const overview = screen.getByRole("article", { name: "ChatGPT" });
    expect(within(overview).getByText("$12.50 / $50.00 spent")).toBeVisible();
    expect(within(overview).getByText("414 credits remaining")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open ChatGPT details" }));
    const detail = screen.getByRole("region", { name: "ChatGPT detail" });
    expect(within(detail).getByText("$12.50 / $50.00 spent")).toBeVisible();
    expect(within(detail).getByText("414 credits remaining")).toBeVisible();

    fireEvent.click(
      within(detail).getByRole("button", {
        name: "Open ChatGPT history for Weekly messages",
      }),
    );
    fireEvent.click(windowCombobox());
    expect(screen.getByRole("option", { name: "Weekly messages" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Extra usage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Credits" })).not.toBeInTheDocument();
  });

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
        state={createEmptyFixtureState()}
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
    const provider = createFixtureState(NOW).instances[0]!;
    provider.snapshot!.usageGroups = [
      {
        id: "priority",
        label: "Priority usage",
        description: "Provider-authored hierarchy.",
        metricIds: ["weekly"],
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
        values: [],
      },
    ]);
  });

  it("hides a collected extra-usage-credits balance of zero from the card", () => {
    const provider = createFixtureState(NOW).instances.find(
      (instance) => instance.providerKind === "grok",
    )!;
    provider.snapshot!.metrics = [
      ...provider.snapshot!.metrics,
      {
        type: "balance",
        id: "extra-usage-credits",
        label: "Extra usage credits",
        scope: "product",
        unit: "USD",
        value: 0,
      },
    ];
    provider.snapshot!.usageGroups = [
      {
        id: "usage-pool",
        label: "Usage pool",
        metricIds: ["weekly-pool", "extra-usage-credits"],
      },
    ];

    const view = providerView(provider, "used", NOW);
    expect(view.values).toEqual([]);
    expect(view.usageGroups[0]?.values).toEqual([]);
    expect(view.usageGroups[0]?.quotas[0]?.id).toBe("weekly-pool");
  });

  it("shows a zero balance for a balance-primary provider", () => {
    const provider = createFixtureState(NOW).instances.find(
      (instance) => instance.providerKind === "grok",
    )!;
    provider.id = "openrouter:default";
    provider.providerKind = "openrouter";
    provider.snapshot = {
      providerKind: "openrouter",
      source: "api-key",
      fetchedAt: NOW,
      metrics: [
        {
          type: "balance",
          id: "balance",
          label: "Balance",
          scope: "general",
          unit: "USD",
          value: 0,
        },
      ],
    };

    expect(providerView(provider, "used", NOW).values).toEqual([
      { id: "balance", label: "Balance", value: "$0.00 remaining" },
    ]);
  });

  it("does not surface Grok short-window rate-limit bars", () => {
    const provider = createFixtureState(NOW).instances.find(
      (instance) => instance.providerKind === "grok",
    )!;
    provider.snapshot!.metrics = [
      {
        type: "quota",
        id: "2-hour-fast-queries",
        label: "2-hour fast queries",
        scope: "general",
        usedRatio: 0.5,
        used: 5,
        limit: 10,
        unit: "queries",
        cycle: { cadence: "rolling", durationMs: 2 * 60 * 60 * 1_000 },
      },
    ];
    provider.snapshot!.usageGroups = [
      {
        id: "rate-limits",
        label: "Chat rate limits",
        metricIds: ["2-hour-fast-queries"],
      },
    ];

    const view = providerView(provider, "used", NOW);
    expect(view.usageGroups).toEqual([
      {
        id: "rate-limits",
        label: "Chat rate limits",
        quotas: [],
        values: [],
      },
    ]);
    expect(view.usageGroups.flatMap((group) => group.quotas)).toEqual([]);
  });

  it("renders quota rows through provider-authored semantic groups", () => {
    const state = createEmptyFixtureState();
    const provider = createFixtureState(NOW).instances[0]!;
    provider.snapshot!.usageGroups = [
      {
        id: "short-term",
        label: "Short-term limits",
        metricIds: ["five-hour"],
      },
      {
        id: "long-term",
        label: "Long-term limits",
        metricIds: ["weekly"],
      },
    ];
    state.instances[0] = provider;

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

  it("renders one generic Usage group without embedded History and before the values footer", () => {
    const state = createEmptyFixtureState();
    const provider = createFixtureState(NOW).instances[0]!;
    delete provider.snapshot!.usageGroups;
    provider.snapshot!.metrics.push(
      {
        type: "balance",
        id: "credits",
        label: "Credits",
        scope: "product",
        unit: "credits",
        value: 414,
      },
    );
    state.instances[0] = provider;

    renderCockpit(state);

    const card = screen.getByRole("article", { name: "ChatGPT" });
    const usage = within(card).getByRole("region", { name: "Usage" });
    const values = within(card).getByRole("region", {
      name: "ChatGPT values",
    });

    expect(
      within(usage).getByRole("group", { name: "5-hour messages" }),
    ).toBeVisible();
    expect(
      within(usage).getByRole("group", { name: "Weekly messages" }),
    ).toBeVisible();
    expect(
      usage.compareDocumentPosition(values) &
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
    const state = createEmptyFixtureState();

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
    expect(screen.getByRole("button", { name: "Connect Grok" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Connect ElevenLabs" }),
    ).toBeVisible();
    expect(screen.queryByText("Permission required")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Antigravity")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "AI Limits" }),
    ).toBeVisible();
    expect(screen.getByText(/One panel for every AI subscription quota/)).toBeVisible();
    expect(screen.getByText("Supported providers · 20")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Refresh usage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("keeps the compact Connect surface inside a labelled action button", () => {
    renderCockpit(createEmptyFixtureState());

    const connect = screen.getByRole("button", { name: "Connect ChatGPT" });
    const visualSurface = within(connect).getByText("Connect");

    expect(connect).toHaveAccessibleName("Connect ChatGPT");
    expect(connect.style.minHeight).toBe("44px");
    expect(visualSurface.tagName).toBe("SPAN");
    expect(visualSurface.style.height).toBe("32px");
    expect(visualSurface).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes distinct screen names and labelled return controls", () => {
    renderCockpit(createEmptyFixtureState());
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Connect your providers",
      }),
    ).toBeVisible();
    cleanup();

    const state = createEmptyFixtureState();
    state.instances[0] = createFixtureState(NOW).instances[0]!;

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
    state.instances[1]!.lastAttempt = {
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
    expect(within(usage).getByText("$8.20 / $20.00 spent")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Claude history" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Connection and capabilities" })).toBeVisible();
    expect(screen.getByText(/Reads usage from your signed-in browser session/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings for Claude" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect Claude" })).toBeVisible();
    expect(
      screen.getByText(
        "Disconnecting permanently deletes this provider's credentials, configuration, usage, and history.",
      ),
    ).toBeVisible();
  });

  it("renders History with compact selectors, ranges, a chart, and the current cycle", () => {
    const state = createFixtureState(NOW);
    state.instances[0]!.history.unshift({
      observedAt: NOW - 4 * 24 * 60 * 60 * 1_000,
      metrics: [
        {
          type: "quota",
          metricId: "five-hour",
          usedRatio: 0.28,
          cycle: {
            cadence: "rolling",
            resetsAt: NOW - 4 * 24 * 60 * 60 * 1_000 + 2 * 60 * 60 * 1_000,
          },
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
    expect(screen.getByText("Window")).toBeVisible();
    expect(screen.queryByText("Metric")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "History provider" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Window" })).toBeVisible();
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

  it("keeps Used/Left and the range radios in one compact filter group", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );

    // Both radiogroups live inside the same .history-controls group so the
    // stylesheet can keep them contiguous (no blank gaps) at any width.
    const controls = document.querySelector(".history-controls");
    expect(controls).not.toBeNull();
    const groups = within(controls as HTMLElement).getAllByRole("radiogroup");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName("Show used or left");
    expect(groups[1]).toHaveAccessibleName("History range");
    expect(
      within(groups[0]!).getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["Used", "Left"]);
    expect(
      within(groups[1]!).getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["48H", "7D", "30D"]);
    expect(
      within(groups[1]!).getByRole("radio", { name: "48 hours" }),
    ).toBeChecked();
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
    chooseWindow("Weekly messages");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT history" }),
    );

    expectWindow("5-hour messages");
  });

  it("opens the exact quota window named by an Overview History affordance", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for Weekly messages",
      }),
    );

    expectWindow("Weekly messages");
  });

  it("preserves the selected range when switching quota windows", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    const sevenDays = screen.getByRole("radio", { name: "7 days" });

    fireEvent.click(sevenDays);
    expect(sevenDays).toBeChecked();
    chooseWindow("Weekly messages");
    expectWindow("Weekly messages");
    expect(sevenDays).toBeChecked();
  });

  it("lets an explicit Overview window override the routed provider's saved selection", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );
    chooseWindow("Weekly messages");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      }),
    );

    expect(
      screen.queryByRole("combobox", { name: "History provider" }),
    ).not.toBeInTheDocument();
    expectWindow("5-hour messages");
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
    chooseWindow("Weekly messages");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    view.rerender(
      <Cockpit
        state={{
          ...state,
          instances: state.instances.map((provider) =>
            provider.providerKind === "chatgpt" && provider.snapshot
              ? {
                  ...provider,
                  snapshot: {
                    ...provider.snapshot,
                    metrics: [provider.snapshot.metrics[0]!],
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
    expectWindow("5-hour messages");
  });

  it("returns from Settings to the Provider that invoked it", () => {
    renderCockpit();

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    const settings = screen.getByRole("button", {
      name: "Settings for ChatGPT",
    });
    settings.focus();
    fireEvent.click(settings);

    expect(
      screen.getByRole("region", { name: "Provider settings" }),
    ).toBeVisible();
    expect(screen.queryByRole("article", { name: "ChatGPT" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));

    expect(screen.getByRole("article", { name: "ChatGPT" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Settings for ChatGPT" }),
    ).toHaveFocus();
  });

  it("disconnects the open provider from its detail screen and returns to Overview", () => {
    const onDisconnectInstance = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onDisconnectInstance={onDisconnectInstance}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));

    expect(onDisconnectInstance).not.toHaveBeenCalled();
    expect(screen.getByRole("article", { name: "ChatGPT" })).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Confirm disconnect" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "This cannot be undone. Credentials, configuration, usage, and history for this provider will be deleted immediately. Permission cleanup can be delayed or shared with another instance.",
      ),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm disconnect ChatGPT" }),
    );

    expect(onDisconnectInstance).toHaveBeenCalledWith("chatgpt:default");
    expect(screen.getByRole("region", { name: "Overview" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Provider unavailable" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the provider detail screen open when disconnect is cancelled", () => {
    const onDisconnectInstance = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onDisconnectInstance={onDisconnectInstance}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel disconnect ChatGPT" }),
    );

    expect(onDisconnectInstance).not.toHaveBeenCalled();
    expect(screen.getByRole("article", { name: "ChatGPT" })).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Confirm disconnect" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect ChatGPT" })).toHaveFocus();
  });

  it("returns to Overview from Settings after disconnecting the provider that opened it", () => {
    const onDisconnectInstance = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onDisconnectInstance={onDisconnectInstance}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open ChatGPT details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings for ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
    expect(onDisconnectInstance).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm disconnect ChatGPT" }),
    );

    expect(onDisconnectInstance).toHaveBeenCalledWith("chatgpt:default");
    expect(
      screen.getByRole("region", { name: "Provider settings" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "ChatGPT" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    expect(screen.getByRole("region", { name: "Overview" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Provider unavailable" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Settings open when disconnect is cancelled", () => {
    const onDisconnectInstance = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onDisconnectInstance={onDisconnectInstance}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel disconnect ChatGPT" }),
    );

    expect(onDisconnectInstance).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Provider settings" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Confirm disconnect" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect ChatGPT" })).toHaveFocus();
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
          instances: state.instances.map((provider) =>
            provider.providerKind === "chatgpt"
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
    const state = createEmptyFixtureState();
    state.instances[0] = createFixtureState(NOW).instances[0]!;

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
    expect(screen.getAllByText(/^Can show:/)).toHaveLength(19);
    expect(screen.getByText(/Connect asks for permission for that provider only/)).toBeVisible();
  });

  it("keeps New API available when every singleton provider is connected", () => {
    renderCockpit();

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    expect(screen.getByText("Available · 14")).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect New API" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect LiteLLM" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect ClawRouter" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect sub2api" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect LLM Proxy" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect ChatGPT" })).not.toBeInTheDocument();
  });

  it("labels an existing permission-required Cursor action as Reconnect", () => {
    const state: AppViewState = {
      preferences: { displayMode: "used", autoRefresh: true },
      providers: createEmptyFixtureState().providers,
      instances: [
        {
          id: "cursor:default",
          providerKind: "cursor",
          access: "required",
          createdAt: NOW,
          history: [
            {
              observedAt: NOW,
              metrics: [
                { type: "quota", metricId: "monthly", usedRatio: 0.4 },
              ],
            },
          ],
        },
      ],
    };

    render(
      <InstanceCockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Reconnect Cursor" })).toBeVisible();
  });

  it("keeps connect actions provider-scoped and disables only the active provider", () => {
    const onConnectProvider = vi.fn();

    render(
      <Cockpit
        state={createEmptyFixtureState()}
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

  it("opens the ElevenLabs guide while preserving browser-session connect behavior", () => {
    const onConnectProvider = vi.fn();
    const onOpenApiKeySetup = vi.fn();
    render(
      <Cockpit
        state={createEmptyFixtureState()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={onConnectProvider}
        onOpenApiKeySetup={onOpenApiKeySetup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
    expect(onConnectProvider).toHaveBeenCalledWith("chatgpt");

    const chatgptRow = screen
      .getByRole("button", { name: "Connect ChatGPT" })
      .closest("article")!;
    expect(within(chatgptRow).getByText("Browser session")).toBeVisible();

    const elevenLabsRow = screen
      .getByRole("button", { name: "Connect ElevenLabs" })
      .closest("article")!;
    expect(within(elevenLabsRow).getByText("API key")).toBeVisible();
    expect(
      within(elevenLabsRow).queryByText("Browser session"),
    ).not.toBeInTheDocument();

    const connectElevenLabs = screen.getByRole("button", {
      name: "Connect ElevenLabs",
    });
    connectElevenLabs.focus();
    fireEvent.click(connectElevenLabs);

    expect(onOpenApiKeySetup).toHaveBeenCalledWith("elevenlabs");
    expect(onConnectProvider).not.toHaveBeenCalledWith("elevenlabs");
    expect(
      screen.getByRole("heading", { name: "Connect ElevenLabs" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Overview" }),
    );
    expect(
      screen.getByRole("button", { name: "Connect ElevenLabs" }),
    ).toHaveFocus();
  });

  it("keeps every catalog connect target aligned with its selected provider", async () => {
    for (const providerKind of providerKinds) {
      const onConnectProvider = vi.fn();
      const onOpenApiKeySetup = vi.fn();
      const onSubmitApiKey = vi.fn(async () => "invalid_key" as const);
      const view = render(
        <Cockpit
          state={createEmptyFixtureState()}
          now={NOW}
          onDisplayModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onConnectProvider={onConnectProvider}
          onOpenApiKeySetup={onOpenApiKeySetup}
          onSubmitApiKey={onSubmitApiKey}
        />,
      );

      const providerName = providerNames[providerKind];
      fireEvent.click(
        screen.getByRole("button", { name: `Connect ${providerName}` }),
      );

      if (isApiKeyProviderKind(providerKind)) {
        expect(onConnectProvider).not.toHaveBeenCalled();
        expect(
          screen.getByRole("heading", {
            level: 1,
            name: `Connect ${providerName}`,
          }),
        ).toBeVisible();
        expect(
          screen.getByRole("heading", { level: 2, name: providerName }),
        ).toBeVisible();
        expect(
          document.querySelector(
            `.provider-mark--provider-${providerKind}`,
          ),
        ).not.toBeNull();
        if (providerPresentation(providerKind).apiKeySetupUrl) {
          expect(onOpenApiKeySetup).toHaveBeenCalledWith(providerKind);
          fireEvent.change(
            screen.getByLabelText(`${providerName} API key`),
            { target: { value: "candidate" } },
          );
        } else {
          expect(onOpenApiKeySetup).not.toHaveBeenCalled();
          fireEvent.change(
            screen.getByLabelText(
              providerKind === "newapi"
                ? "New API site URL"
                : `${providerName} instance URL`,
            ),
            { target: { value: "https://provider.example" } },
          );
          fireEvent.change(
            screen.getByLabelText(
              providerKind === "newapi"
                ? "New API relay key"
                : `${providerName} API key`,
            ),
            { target: { value: "candidate" } },
          );
        }
        fireEvent.click(
          screen.getByRole("button", { name: "Validate & connect" }),
        );
        await waitFor(() =>
          expect(onSubmitApiKey).toHaveBeenCalledWith(
            providerKind,
            "candidate",
            providerPresentation(providerKind).apiKeySetupUrl
              ? undefined
              : "https://provider.example",
          ),
        );
      } else {
        expect(onConnectProvider).toHaveBeenCalledWith(providerKind);
        expect(onOpenApiKeySetup).not.toHaveBeenCalled();
      }

      view.unmount();
    }
  });

  it("returns to Overview after a successful API-key connection", async () => {
    render(
      <Cockpit
        state={createEmptyFixtureState()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onOpenApiKeySetup={vi.fn()}
        onSubmitApiKey={vi.fn(async () => "connected" as const)}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Connect ElevenLabs" }),
    );
    fireEvent.change(screen.getByLabelText("ElevenLabs API key"), {
      target: { value: "not-a-real-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    expect(
      await screen.findByRole("heading", { name: "Connect your providers" }),
    ).toBeVisible();
  });

  it("opens New API onboarding without opening a tab and submits the normalized instance", async () => {
    const onOpenApiKeySetup = vi.fn();
    const onSubmitApiKey = vi.fn(async () => "connected" as const);
    render(
      <Cockpit
        state={createEmptyFixtureState()}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onOpenApiKeySetup={onOpenApiKeySetup}
        onSubmitApiKey={onSubmitApiKey}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect New API" }));
    expect(onOpenApiKeySetup).not.toHaveBeenCalledWith("newapi");
    expect(screen.getByRole("heading", { name: "Connect New API" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Connect your providers" }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://api.example.com/gateway/v1/messages" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    await waitFor(() =>
      expect(onSubmitApiKey).toHaveBeenCalledWith(
        "newapi",
        "sk-test",
        "https://api.example.com/gateway/v1/messages",
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Connect your providers" }),
    ).toBeVisible();
  });

  it("offers credential recovery from the provider card", () => {
    const state = createFixtureState(NOW);
    const elevenLabs = state.instances.find(
      (provider) => provider.providerKind === "elevenlabs",
    )!;
    elevenLabs.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "failure", category: "credential_invalid" },
    };
    const onOpenApiKeySetup = vi.fn();

    render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onOpenApiKeySetup={onOpenApiKeySetup}
      />,
    );

    const card = screen.getByRole("article", { name: "ElevenLabs" });
    expect(
      within(card).queryByRole("button", { name: "Refresh ElevenLabs" }),
    ).not.toBeInTheDocument();
    const replace = within(card).getByRole("button", {
      name: "Replace ElevenLabs API key",
    });
    expect(replace).toHaveAttribute("title", "Replace ElevenLabs API key");
    expect(replace.querySelector('[data-icon="key"]')).not.toBeNull();
    expect(replace.querySelector('[data-icon="refresh"]')).toBeNull();
    fireEvent.click(replace);

    expect(onOpenApiKeySetup).toHaveBeenCalledWith("elevenlabs");
    expect(
      screen.getByRole("heading", { name: "Replace ElevenLabs API key" }),
    ).toBeVisible();
  });

  it("shows only saved-key status and replacement in ElevenLabs settings", () => {
    const onOpenApiKeySetup = vi.fn();
    render(
      <Cockpit
        state={createFixtureState(NOW)}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onOpenApiKeySetup={onOpenApiKeySetup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const row = screen.getByText("ElevenLabs").closest("li")!;
    expect(row).toHaveTextContent(/Updated just now · API key · read-only/);
    expect(row).not.toHaveTextContent("Browser session");
    expect(within(row).getByText("API key saved")).toBeVisible();
    expect(row).not.toHaveTextContent(/\*|last|ending/i);
    expect(
      within(row).getByRole("button", { name: "Disconnect ElevenLabs" }),
    ).toBeVisible();
    fireEvent.click(
      within(row).getByRole("button", { name: "Replace ElevenLabs API key" }),
    );

    expect(onOpenApiKeySetup).toHaveBeenCalledWith("elevenlabs");
    expect(
      screen.getByRole("heading", { name: "Replace ElevenLabs API key" }),
    ).toBeVisible();
  });

  it("restores focus to the invoker after Back from Add Provider", () => {
    const state = createEmptyFixtureState();
    state.instances[0] = createFixtureState(NOW).instances[0]!;

    renderCockpit(state);

    const addProvider = screen.getByRole("button", { name: "Add provider" });
    addProvider.focus();
    fireEvent.click(addProvider);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    expect(screen.getByRole("button", { name: "Add provider" })).toHaveFocus();
  });

  it("opens Add Provider from Settings and restores focus to its remounted invoker", () => {
    const state = createEmptyFixtureState();
    state.instances[0] = createFixtureState(NOW).instances[0]!;

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

    renderCockpit(createEmptyFixtureState());
    let kimi = screen.getByRole("article", { name: "Kimi" });
    expect(within(kimi).getByText(connectionDisclosure)).toBeVisible();
    expect(within(kimi).getByText(recoveryDisclosure)).toBeVisible();
    cleanup();

    const state = createEmptyFixtureState();
    state.instances[0] = createFixtureState(NOW).instances[0]!;
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
    expect(screen.getByText("$8.20 / $20.00 spent")).toBeVisible();
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
        "Last refresh just now · 7 providers",
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

  it("dismisses only the visible Overview refresh summary", () => {
    const state = createFixtureState(NOW);
    const onRefresh = vi.fn();
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        refreshAnnouncement="Updated 4 providers."
        refreshAnnouncementId={11}
        onDisplayModeChange={vi.fn()}
        onRefresh={onRefresh}
        onConnectProvider={vi.fn()}
      />,
    );

    const dismiss = screen.getByRole("button", {
      name: "Dismiss refresh summary",
    });
    expect(dismiss).toBeVisible();
    expect(dismiss).toHaveTextContent("×");
    fireEvent.click(dismiss);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "ChatGPT" })).toBeVisible();
    expect(state.instances).toHaveLength(7);
    expect(onRefresh).not.toHaveBeenCalled();

    view.rerender(
      <Cockpit
        state={state}
        now={NOW}
        refreshAnnouncement="Updated 7 providers."
        refreshAnnouncementId={12}
        onDisplayModeChange={vi.fn()}
        onRefresh={onRefresh}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Updated 7 providers.",
    );
  });

  it("formats the known ChatGPT plan value at the display boundary", () => {
    const state = createFixtureState(NOW);
    state.instances[0]!.snapshot!.planLabel = "plus";

    renderCockpit(state);

    const chatGpt = within(screen.getByRole("article", { name: "ChatGPT" }));
    expect(chatGpt.getByText("Plus")).toBeVisible();
    expect(chatGpt.queryByText("plus")).not.toBeInTheDocument();
  });

  it("formats known Cursor and ElevenLabs plan values at the display boundary", () => {
    const state = createFixtureState(NOW);
    const cursor = state.instances.find(
      (instance) => instance.providerKind === "cursor",
    )!;
    const elevenLabs = state.instances.find(
      (instance) => instance.providerKind === "elevenlabs",
    )!;
    cursor.snapshot!.planLabel = "ultra";
    elevenLabs.snapshot!.planLabel = "free";

    renderCockpit(state);

    expect(
      within(screen.getByRole("article", { name: "Cursor" })).getByText("Ultra"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: "ElevenLabs" })).getByText("Free"),
    ).toBeVisible();
  });

  it("formats known plan values in Settings", () => {
    const state = createFixtureState(NOW);
    const elevenLabs = state.instances.find(
      (instance) => instance.providerKind === "elevenlabs",
    )!;
    elevenLabs.snapshot!.planLabel = "free";

    renderCockpit(state);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const row = screen.getByRole("listitem", { name: "ElevenLabs settings" });
    expect(within(row).getByText("Free")).toBeVisible();
    expect(within(row).queryByText("free")).not.toBeInTheDocument();
  });

  it("preserves an unknown provider plan label", () => {
    const state = createFixtureState(NOW);
    const newApi = state.instances.find(
      (instance) => instance.providerKind === "newapi",
    )!;
    newApi.snapshot!.planLabel = "iCloud Partner";

    renderCockpit(state);

    expect(
      within(
        screen.getByRole("article", { name: "New API Demo relay A" }),
      ).getByText("iCloud Partner"),
    ).toBeVisible();
  });

  it("describes pace deltas as over or under pace", () => {
    const state = createFixtureState(NOW);
    const weekly = state.instances[0]!.snapshot!.metrics.find(
      (metric) => metric.type === "quota" && metric.id === "weekly",
    );
    if (!weekly || weekly.type !== "quota") {
      throw new Error("Expected the weekly quota fixture.");
    }
    weekly.usedRatio = 0.5;

    renderCockpit(state);

    expect(screen.getByText("12 pts over pace")).toBeVisible();
    expect(screen.getByText("21 pts under pace")).toBeVisible();
    expect(screen.queryByText(/points? ahead|points? behind/)).not.toBeInTheDocument();
  });

  it("shows the most recent finished attempt in the idle header", () => {
    const state = createFixtureState(NOW);
    state.instances.forEach((provider) => {
      provider.snapshot!.fetchedAt = NOW - 10 * 60 * 1_000;
    });
    state.instances[1]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 3 * 60 * 1_000 - 2_000,
      finishedAt: NOW - 3 * 60 * 1_000,
      outcome: { kind: "success" },
    };

    renderCockpit(state);

    expect(
      screen.getByText("Last refresh 3 minutes ago · 7 providers"),
    ).toBeVisible();
  });

  it("keeps counter and balance values unchanged in Used and Left modes", () => {
    const state = createFixtureState(NOW);
    state.instances[0]!.snapshot!.metrics.push(
      {
        type: "counter",
        id: "extra-usage",
        label: "Extra usage",
        scope: "product",
        semantic: "spent",
        unit: "USD",
        value: 12.5,
      },
      {
        type: "balance",
        id: "credits",
        label: "Credits",
        scope: "product",
        unit: "credits",
        value: 414,
      },
    );
    const view = render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );

    expect(screen.getByText("$12.50 spent")).toBeVisible();
    expect(screen.getByText("414 credits remaining")).toBeVisible();

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
    expect(screen.getByText("$12.50 spent")).toBeVisible();
    expect(screen.getByText("414 credits remaining")).toBeVisible();
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

    const weekly = within(
      within(screen.getByRole("article", { name: "ChatGPT" })).getByRole(
        "group",
        { name: "Weekly messages" },
      ),
    );
    const pace = weekly.getByText(/pts (over|under) pace|On pace/).textContent;

    expect(
      weekly.getByRole("meter", { name: "Weekly messages time elapsed" }),
    ).toHaveAttribute("aria-valuenow", "71.4286");
    expect(weekly.getByText("5 / 7 days elapsed")).toBeVisible();

    const reset = weekly.getByText(/^Resets /);
    expect(reset.tagName).toBe("TIME");
    expect(reset).toHaveAttribute(
      "datetime",
      new Date(
        state.instances[0]!.snapshot!.metrics.find(
          (metric) => metric.type === "quota" && metric.id === "weekly",
        )!.cycle!.resetsAt!,
      ).toISOString(),
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
      within(screen.getByRole("article", { name: "ChatGPT" })).getByRole(
        "group",
        { name: "Weekly messages" },
      ),
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
    const chatGpt = state.instances[0];

    if (!chatGpt?.snapshot) {
      throw new Error("Expected the ChatGPT fixture snapshot.");
    }

    const untimedState: AppViewState = {
      ...state,
      instances: [
        {
          ...chatGpt,
          snapshot: {
            ...chatGpt.snapshot,
            metrics: [
              {
                ...chatGpt.snapshot.metrics[0]!,
                cycle: undefined,
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
        state={createEmptyFixtureState()}
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
    const state = createEmptyFixtureState();

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
    state.instances[0]!.snapshot!.source = "web-session";

    renderCockpit(state);

    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect ChatGPT" }),
    ).not.toBeInTheDocument();
  });

  it("shows failed snapshot-free health in the padded empty state", () => {
    const state = createEmptyFixtureState();
    const { snapshot: _snapshot, ...chatGpt } = createFixtureState(NOW).instances[0]!;
    state.instances = [{ ...chatGpt, access: "granted" }];
    state.instances[0]!.lastAttempt = {
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
    state.instances = [state.instances[0]!];
    state.instances[0]!.snapshot!.fetchedAt = NOW - 35 * 60 * 1_000;
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
    state.instances = [state.instances[2]!];
    state.instances[0]!.snapshot!.fetchedAt = NOW - 34 * 60 * 1_000;
    state.instances[0]!.lastAttempt = {
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
    state.instances = [state.instances[0]!];
    state.instances[0]!.snapshot!.fetchedAt = NOW - 34 * 60 * 1_000;
    state.instances[0]!.lastAttempt = {
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
    state.instances[0]!.history.push({
      observedAt: NOW - 15 * 60 * 1_000,
      metrics: [
        { type: "quota", metricId: "retired-window", usedRatio: 0.9 },
      ],
    });

    renderCockpit(state);

    expect(
      screen.getAllByRole("button", { name: /^Open .* history for / }),
    ).toHaveLength(12);
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
    const windowSelect = windowCombobox();
    expect(windowSelect).toBeVisible();
    fireEvent.click(windowSelect);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["5-hour messages", "Weekly messages"]);
    expect(
      screen.queryByRole("option", {
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
    disconnected.instances = [
      { ...disconnected.instances[0]!, access: "required" },
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

    const snapshotFree = createEmptyFixtureState();
    const { snapshot: _snapshot, ...chatGpt } = createFixtureState(NOW).instances[0]!;
    snapshotFree.instances = [{ ...chatGpt, access: "granted" }];
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
    const source = createFixtureState(NOW).instances[2]!;
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
    const state: AppViewState = {
      ...createEmptyFixtureState(),
      instances: [provider],
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
    state.instances = [state.instances[0]!, state.instances[2]!];

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
    const state = createEmptyFixtureState();

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

  it("offers Settings reconnect for a permission-required Cursor without deleting its data", () => {
    const state = createFixtureState(NOW);
    state.instances = state.instances.map((instance) =>
      instance.providerKind === "cursor"
        ? { ...instance, access: "required" }
        : instance,
    );
    const cursorBefore = structuredClone(
      state.instances.find((instance) => instance.providerKind === "cursor"),
    );
    const onConnectProvider = vi.fn();
    render(
      <Cockpit
        state={state}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={onConnectProvider}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const cursorRow = screen.getByRole("listitem", { name: "Cursor settings" });
    fireEvent.click(
      within(cursorRow).getByRole("button", { name: "Reconnect Cursor" }),
    );

    expect(onConnectProvider).toHaveBeenCalledWith("cursor");
    expect(
      state.instances.find((instance) => instance.providerKind === "cursor"),
    ).toEqual(cursorBefore);
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
    const providerContent = claudeRow.querySelector(".settings-provider-content");
    const providerCopy = claudeRow.querySelector(".settings-provider-copy");
    const providerActions = claudeRow.querySelector(".settings-provider-actions");
    expect(providerContent).not.toBeNull();
    expect(providerCopy?.parentElement).toBe(providerContent);
    expect(providerActions?.parentElement).toBe(providerContent);
    expect(providerCopy?.nextElementSibling).toBe(providerActions);
    for (const action of within(providerActions as HTMLElement).getAllByRole("button")) {
      expect(action).toHaveAttribute("type", "button");
      expect(action.parentElement).toBe(providerActions);
    }
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    expect(onDisconnectProvider).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm disconnect Claude" }),
    );
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
    expect(deleteTrigger.tagName).toBe("BUTTON");
    expect(deleteTrigger).toHaveAttribute("type", "button");
    expect(deleteTrigger).toHaveClass(
      "button",
      "button--danger-outline",
      "danger-zone__trigger",
    );
    expect(deleteTrigger.querySelector('[data-icon="trash"]')).not.toBeNull();
    expect(deleteTrigger.querySelector(".danger-zone__trigger-surface")).not.toBeNull();
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
    expect(localMarks).toHaveLength(7);
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
