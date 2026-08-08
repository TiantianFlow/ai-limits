import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createFixtureState } from "../../providers/fixtures";
import { createInitialState } from "../../providers/initial-state";
import { App } from "./App";

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

describe("side-panel App", () => {
  test("loads and changes display mode only through service-worker commands", async () => {
    const state = createFixtureState(Date.UTC(2026, 7, 7, 16));
    const commands: unknown[] = [];
    const storageWrite = vi.spyOn(browser.storage.local, "set");

    messageListener = (message, _sender, sendResponse) => {
      commands.push(message);
      sendResponse(state);
      return true;
    };
    browser.runtime.onMessage.addListener(messageListener);

    render(<App />);

    expect(await screen.findByText("ChatGPT")).toBeVisible();
    expect(commands).toEqual([{ type: "GET_STATE" }]);

    fireEvent.click(screen.getByRole("button", { name: "Left" }));

    expect(commands).toEqual([
      { type: "GET_STATE" },
      { type: "SET_DISPLAY_MODE", mode: "left" },
    ]);
    expect(storageWrite).not.toHaveBeenCalled();
  });

  test("waits for direct permission approval before collecting a provider", async () => {
    const initialState = createInitialState();
    const signedOutState = {
      ...initialState,
      providers: initialState.providers.map((provider) =>
        provider.providerId === "chatgpt"
          ? {
              ...provider,
              health: {
                kind: "signed_out" as const,
                message: "Sign in to ChatGPT, then try again.",
              },
            }
          : provider,
      ),
    };
    const commands: unknown[] = [];
    let approvePermission: ((granted: boolean) => void) | undefined;
    const permissionDecision = new Promise<boolean>((resolve) => {
      approvePermission = resolve;
    });
    vi.spyOn(browser.permissions, "request").mockImplementation(
      () => permissionDecision as never,
    );

    messageListener = (message, _sender, sendResponse) => {
      commands.push(message);
      sendResponse(
        (message as { type?: string }).type === "COLLECT_PROVIDER"
          ? signedOutState
          : initialState,
      );
      return true;
    };
    browser.runtime.onMessage.addListener(messageListener);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Check ChatGPT session" }),
    );

    expect(screen.getByText("Connecting")).toBeVisible();
    expect(commands).toEqual([{ type: "GET_STATE" }]);

    approvePermission?.(true);

    expect(await screen.findByText("Signed out")).toBeVisible();
    expect(commands).toEqual([
      { type: "GET_STATE" },
      { type: "COLLECT_PROVIDER", providerId: "chatgpt" },
    ]);
  });

  test("shows a provider error when Chrome rejects the permission request", async () => {
    const initialState = createInitialState();
    const commands: unknown[] = [];
    vi.spyOn(browser.permissions, "request").mockRejectedValue(
      new Error("This function must be called during a user gesture"),
    );

    messageListener = (message, _sender, sendResponse) => {
      commands.push(message);
      sendResponse(initialState);
      return true;
    };
    browser.runtime.onMessage.addListener(messageListener);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Check ChatGPT session" }),
    );

    expect(
      await screen.findByText(/Chrome couldn't request access/i),
    ).toBeVisible();
    await waitFor(() => expect(commands).toEqual([{ type: "GET_STATE" }]));
  });
});
