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
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  AppState,
  ProviderRefreshOutcome,
  RefreshReport,
} from "../../domain/model";
import { createFixtureState } from "../../providers/fixtures";
import { createInitialState } from "../../providers/initial-state";
import { saveState } from "../../storage/repository";
import { App } from "./App";

const NOW = Date.UTC(2026, 7, 7, 16);

let messageListener:
  | ((
      message: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean)
  | undefined;

afterEach(() => {
  cleanup();
  if (messageListener) {
    browser.runtime.onMessage.removeListener(messageListener);
    messageListener = undefined;
  }
  vi.restoreAllMocks();
});

function installMessageHandler(
  handler: (message: Record<string, unknown>, respond: (value: unknown) => void) => void,
) {
  messageListener = (message, _sender, sendResponse) => {
    handler(message as Record<string, unknown>, sendResponse);
    return true;
  };
  browser.runtime.onMessage.addListener(messageListener);
}

function report(
  providers: RefreshReport["providers"],
  trigger: RefreshReport["trigger"] = "manual_all",
): RefreshReport {
  return { trigger, startedAt: NOW, finishedAt: NOW + 1_000, providers };
}

function successfulOutcomes(state: AppState): RefreshReport["providers"] {
  return Object.fromEntries(
    state.providers.map((provider) => [
      provider.providerId,
      {
        kind: "success",
        snapshot: provider.snapshot!,
      } satisfies ProviderRefreshOutcome,
    ]),
  );
}

describe("side-panel App", () => {
  test("offers a retry when the initial state load fails", async () => {
    const state = createFixtureState(NOW);
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockImplementationOnce(async () => state as never);

    render(<App />);

    expect(await screen.findByText("Couldn’t load usage.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading usage" }));

    expect(await screen.findByText("ChatGPT")).toBeVisible();
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "GET_STATE" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "GET_STATE" });
  });

  test("offers the same retry when the worker returns no initial state", async () => {
    const state = createFixtureState(NOW);
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => state as never);

    render(<App />);

    expect(await screen.findByText("Couldn’t load usage.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading usage" }));
    expect(await screen.findByText("ChatGPT")).toBeVisible();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test("keeps existing usage visible while manual refresh work is pending", async () => {
    const state = createFixtureState(NOW);
    let finishRefresh: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "REFRESH_ALL") {
        finishRefresh = respond;
        return;
      }
      respond(state);
    });

    render(<App />);

    expect(await screen.findByText("72% used")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));

    const pendingButton = screen.getByRole("button", { name: "Refreshing usage" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("72% used")).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: "ChatGPT" })).getByText(
        "Fetching usage…",
      ),
    ).toBeVisible();

    act(() =>
      finishRefresh?.({ state, report: report(successfulOutcomes(state)) }),
    );
    await waitFor(() => expect(pendingButton).toBeEnabled());
  });

  test.each([
    {
      name: "all attempted providers succeed",
      state: createFixtureState(NOW),
      outcomes: successfulOutcomes(createFixtureState(NOW)),
      expected: "Updated 4 providers.",
    },
    {
      name: "Kimi is the only provider needing a session",
      state: createFixtureState(NOW),
      outcomes: {
        ...successfulOutcomes(createFixtureState(NOW)),
        kimi: { kind: "deferred", reason: "session_required" } as const,
      },
      expected: "Updated 3 of 4. Kimi needs a browser session.",
    },
    {
      name: "mixed non-success outcomes need attention",
      state: createFixtureState(NOW),
      outcomes: {
        chatgpt: successfulOutcomes(createFixtureState(NOW)).chatgpt,
        claude: { kind: "failure", category: "signed_out" } as const,
        kimi: { kind: "deferred", reason: "session_required" } as const,
      },
      expected: "Updated 1 of 3. Some providers need attention.",
    },
    {
      name: "none of the attempted providers succeed",
      state: createFixtureState(NOW),
      outcomes: {
        chatgpt: { kind: "failure", category: "temporary_error" } as const,
        claude: { kind: "failure", category: "signed_out" } as const,
      },
      expected: "No providers updated. Existing data is unchanged.",
    },
    {
      name: "no providers have permission",
      state: createInitialState(),
      outcomes: {
        chatgpt: { kind: "skipped", reason: "permission_required" } as const,
        claude: { kind: "skipped", reason: "permission_required" } as const,
        kimi: { kind: "skipped", reason: "permission_required" } as const,
        cursor: { kind: "skipped", reason: "permission_required" } as const,
      },
      expected: "Connect a provider before refreshing.",
    },
  ])("announces a truthful manual summary when $name", async ({ state, outcomes, expected }) => {
    installMessageHandler((message, respond) => {
      respond(
        message.type === "REFRESH_ALL"
          ? { state, report: report(outcomes) }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));

    expect(await screen.findByRole("status")).toHaveTextContent(expected);
  });

  test("shows provider-scoped permission and fetch operations", async () => {
    const initialState = createInitialState();
    const connectedState = createFixtureState(NOW);
    let approvePermission: ((granted: boolean) => void) | undefined;
    let finishCollection: ((value: unknown) => void) | undefined;
    vi.spyOn(browser.permissions, "request").mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          approvePermission = resolve;
        }) as never,
    );
    installMessageHandler((message, respond) => {
      if (message.type === "COLLECT_PROVIDER") {
        finishCollection = respond;
        return;
      }
      respond(initialState);
    });

    render(<App />);
    const card = await screen.findByRole("article", { name: "ChatGPT" });
    fireEvent.click(within(card).getByRole("button", { name: "Connect ChatGPT" }));

    expect(within(card).getByText("Requesting permission…")).toBeVisible();
    act(() => approvePermission?.(true));
    expect(await within(card).findByText("Fetching usage…")).toBeVisible();

    act(() =>
      finishCollection?.({
        state: connectedState,
        report: report(
          { chatgpt: successfulOutcomes(connectedState).chatgpt },
          "connect",
        ),
      }),
    );
    await waitFor(() =>
      expect(within(card).queryByText("Fetching usage…")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Updated 1 provider.");
  });

  test("announces a declined permission decision", async () => {
    const state = createInitialState();
    vi.spyOn(browser.permissions, "request").mockResolvedValue(false as never);
    installMessageHandler((_message, respond) => respond(state));

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ChatGPT" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "ChatGPT was not connected.",
    );
  });

  test("uses connect-specific recovery copy when permission request fails", async () => {
    const state = createInitialState();
    const commands: unknown[] = [];
    vi.spyOn(browser.permissions, "request").mockRejectedValue(
      new Error("permissions API unavailable") as never,
    );
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(state);
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ChatGPT" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t connect ChatGPT. Reload AI Limits and try again.",
    );
    expect(commands).toEqual([{ type: "GET_STATE" }]);
  });

  test("shows Kimi waiting only after the recovery boundary emits progress", async () => {
    const state = createFixtureState(NOW);
    let finishRefresh: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "REFRESH_ALL") {
        finishRefresh = respond;
        return;
      }
      respond(state);
    });

    render(<App />);
    const kimi = await screen.findByRole("article", { name: "Kimi" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));

    expect(within(kimi).getByText("Fetching usage…")).toBeVisible();
    expect(within(kimi).queryByText("Waiting for Kimi…")).not.toBeInTheDocument();

    act(() => {
      void browser.runtime.sendMessage({
        type: "PROVIDER_OPERATION",
        providerId: "kimi",
        operation: "waiting_for_session",
      });
    });
    expect(await within(kimi).findByText("Waiting for Kimi…")).toBeVisible();
    expect(within(kimi).getByText("55% used")).toBeVisible();

    act(() =>
      finishRefresh?.({ state, report: report(successfulOutcomes(state)) }),
    );
    await waitFor(() =>
      expect(within(kimi).queryByText("Waiting for Kimi…")).not.toBeInTheDocument(),
    );
  });

  test("does not expose scheduled attempt state through an aria-live region", async () => {
    const state = createFixtureState(NOW);
    state.providers[2]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "deferred", reason: "session_required" },
    };
    installMessageHandler((_message, respond) => respond(state));

    render(<App />);

    expect(await screen.findByText("Kimi")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("re-announces identical provider refresh outcomes", async () => {
    const fixture = createFixtureState(0);
    const kimi = fixture.providers[2]!;
    kimi.lastAttempt = {
      trigger: "scheduled",
      startedAt: 1,
      finishedAt: 2,
      outcome: { kind: "deferred", reason: "session_required" },
    };
    const state: AppState = { ...fixture, providers: [kimi] };
    installMessageHandler((message, respond) => {
      respond(
        message.type === "REFRESH_PROVIDER"
          ? {
              state,
              report: report(
                { kimi: { kind: "deferred", reason: "session_required" } },
                "manual_provider",
              ),
            }
          : state,
      );
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh Kimi" }));
    const firstStatus = await screen.findByRole("status");
    expect(firstStatus).toHaveTextContent(
      "No providers updated. Existing data is unchanged.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh Kimi" }));
    await waitFor(() => expect(screen.getByRole("status")).not.toBe(firstStatus));
    expect(screen.getByRole("status")).toHaveTextContent(
      "No providers updated. Existing data is unchanged.",
    );
  });

  test("uses confirmation-failure copy when global refresh transport fails", async () => {
    const state = createFixtureState(NOW);
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "REFRESH_ALL") {
          throw new Error("response channel closed");
        }
        return state as never;
      },
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh usage" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the refresh result. Check the latest usage before retrying.",
    );
  });

  test("uses confirmation-failure copy when provider refresh transport fails", async () => {
    const fixture = createFixtureState(0);
    const kimi = fixture.providers[2]!;
    kimi.lastAttempt = {
      trigger: "scheduled",
      startedAt: 1,
      finishedAt: 2,
      outcome: { kind: "deferred", reason: "session_required" },
    };
    const state: AppState = { ...fixture, providers: [kimi] };
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "REFRESH_PROVIDER") {
          throw new Error("response channel closed");
        }
        return state as never;
      },
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh Kimi" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the Kimi refresh result. Check the latest usage before retrying.",
    );
  });

  test("uses confirmation-failure copy when connect transport fails", async () => {
    const state = createInitialState();
    vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "COLLECT_PROVIDER") {
          throw new Error("response channel closed");
        }
        return state as never;
      },
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ChatGPT" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the ChatGPT refresh result. Check the latest usage before retrying.",
    );
  });

  test("keeps the authoritative auto-refresh value when the command fails", async () => {
    const state = createFixtureState(NOW);
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "SET_AUTO_REFRESH") {
          throw new Error("worker unavailable");
        }
        return state as never;
      },
    );

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    fireEvent.click(autoRefresh);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t update automatic refresh.",
    );
    expect(autoRefresh).toBeChecked();
    expect(autoRefresh).toBeEnabled();
  });

  test("disables auto-refresh control until authoritative state returns", async () => {
    const state = createFixtureState(NOW);
    const disabledState = structuredClone(state);
    disabledState.preferences.autoRefresh = false;
    let finishToggle: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "SET_AUTO_REFRESH") {
        finishToggle = respond;
        return;
      }
      respond(state);
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    fireEvent.click(autoRefresh);

    expect(autoRefresh).toBeChecked();
    expect(autoRefresh).toBeDisabled();
    act(() => finishToggle?.(disabledState));
    await waitFor(() => expect(autoRefresh).not.toBeChecked());
    expect(autoRefresh).toBeEnabled();
  });

  test("pins the prior automatic-refresh value during pending storage events", async () => {
    const state = createFixtureState(NOW);
    const disabledState = structuredClone(state);
    disabledState.preferences.autoRefresh = false;
    let finishToggle: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "SET_AUTO_REFRESH") {
        finishToggle = respond;
        return;
      }
      respond(state);
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    fireEvent.click(autoRefresh);

    await act(async () => saveState(disabledState, NOW));
    expect(autoRefresh).toBeChecked();
    expect(autoRefresh).toBeDisabled();

    act(() => finishToggle?.(disabledState));
    await waitFor(() => expect(autoRefresh).not.toBeChecked());
    expect(autoRefresh).toBeEnabled();
  });

  test("announces a completed provider disconnect", async () => {
    const state = createFixtureState(NOW);
    const disconnected = structuredClone(state);
    disconnected.providers[0] = {
      providerId: "chatgpt",
      access: "required",
      history: [],
    };
    installMessageHandler((message, respond) => {
      respond(message.type === "DISCONNECT_PROVIDER" ? disconnected : state);
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Disconnected ChatGPT and deleted its stored usage.",
    );
  });

  test("routes settings mutations through service-worker commands", async () => {
    const state = createFixtureState(NOW);
    const commands: unknown[] = [];
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "DELETE_LOCAL_DATA"
          ? { state: createInitialState(), result: "deleted" }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Automatic refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete all local data" }));

    await waitFor(() =>
      expect(commands).toEqual([
        { type: "GET_STATE" },
        { type: "SET_AUTO_REFRESH", enabled: false },
        { type: "DISCONNECT_PROVIDER", providerId: "chatgpt" },
        { type: "DELETE_LOCAL_DATA" },
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Local usage data deleted and providers disconnected.",
    );
  });

  test("announces sanitized partial permission cleanup after deleting local data", async () => {
    const state = createFixtureState(NOW);
    installMessageHandler((message, respond) => {
      respond(
        message.type === "DELETE_LOCAL_DATA"
          ? {
              state: createInitialState(),
              result: "deleted_with_permission_errors",
            }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm delete all local data" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Local usage data deleted. Some provider access could not be removed.",
    );
  });
});
