import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createFixtureState } from "../../providers/fixtures";
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
});
