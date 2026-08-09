import { describe, expect, test, vi } from "vitest";

import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
} from "./messages";

describe("runtime command router", () => {
  test("dispatches only the exact fixed command shapes", async () => {
    const refreshResult = {
      state: { version: 2 },
      report: { trigger: "manual_all" },
    };
    const providerRefreshResult = {
      state: { version: 2 },
      report: { trigger: "manual_provider" },
    };
    const handlers = {
      refreshAll: vi.fn(async () => refreshResult),
      collectProvider: vi.fn(async () => ({
        state: { version: 2 },
        report: { trigger: "connect" },
      })),
      refreshProvider: vi.fn(async () => providerRefreshResult),
      getState: vi.fn(async () => "state"),
      setDisplayMode: vi.fn(async () => "updated"),
    };
    const handle = createRuntimeCommandHandler(handlers);

    await expect(handle({ type: "REFRESH_ALL" })).resolves.toBe(refreshResult);
    await expect(
      handle({ type: "COLLECT_PROVIDER", providerId: "chatgpt" }),
    ).resolves.toMatchObject({ report: { trigger: "connect" } });
    await expect(
      handle({ type: "COLLECT_PROVIDER", providerId: "claude" }),
    ).resolves.toMatchObject({ report: { trigger: "connect" } });
    await expect(
      handle({ type: "COLLECT_PROVIDER", providerId: "kimi" }),
    ).resolves.toMatchObject({ report: { trigger: "connect" } });
    await expect(
      handle({ type: "COLLECT_PROVIDER", providerId: "cursor" }),
    ).resolves.toEqual({
      state: { version: 2 },
      report: { trigger: "connect" },
    });
    await expect(
      handle({ type: "REFRESH_PROVIDER", providerId: "kimi" }),
    ).resolves.toBe(providerRefreshResult);
    await expect(handle({ type: "GET_STATE" })).resolves.toBe("state");
    await expect(
      handle({ type: "SET_DISPLAY_MODE", mode: "used" }),
    ).resolves.toBe("updated");
    await expect(
      handle({ type: "SET_DISPLAY_MODE", mode: "left" }),
    ).resolves.toBe("updated");
    expect(handlers.collectProvider).toHaveBeenNthCalledWith(1, "chatgpt");

    expect(handle({ type: "FETCH", url: "https://attacker.invalid" })).toBeUndefined();
    expect(
      handle({
        type: "REFRESH_ALL",
        url: "https://attacker.invalid",
      }),
    ).toBeUndefined();
    expect(
      handle({ type: "COLLECT_PROVIDER", providerId: "antigravity" }),
    ).toBeUndefined();
    expect(
      handle({ type: "REFRESH_PROVIDER", providerId: "antigravity" }),
    ).toBeUndefined();
    expect(
      handle({
        type: "COLLECT_PROVIDER",
        providerId: "claude",
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      handle({ type: "SET_DISPLAY_MODE", mode: "remaining" }),
    ).toBeUndefined();
    expect(
      handle({ type: "SET_DISPLAY_MODE", mode: "left", extra: true }),
    ).toBeUndefined();
    expect(handlers.refreshAll).toHaveBeenCalledTimes(1);
    expect(handlers.collectProvider).toHaveBeenCalledTimes(4);
    expect(handlers.refreshProvider).toHaveBeenCalledTimes(1);
    expect(handlers.refreshProvider).toHaveBeenCalledWith("kimi");
    expect(handlers.getState).toHaveBeenCalledTimes(1);
    expect(handlers.setDisplayMode).toHaveBeenNthCalledWith(1, "used");
    expect(handlers.setDisplayMode).toHaveBeenNthCalledWith(2, "left");
  });

  test("keeps the response channel open only for accepted async commands", async () => {
    const handleCommand = vi.fn(async () => ({ demoMode: true }));
    const sendResponse = vi.fn();
    const listener = createChromeRuntimeMessageListener(handleCommand);

    expect(
      listener(
        { type: "GET_STATE" },
        {} as Browser.runtime.MessageSender,
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ demoMode: true }),
    );
    expect(handleCommand).toHaveBeenCalledWith({ type: "GET_STATE" });

    handleCommand.mockClear();
    sendResponse.mockClear();
    expect(
      listener(
        { type: "REFRESH_ALL", url: "https://attacker.invalid" },
        {} as Browser.runtime.MessageSender,
        sendResponse,
      ),
    ).toBe(false);
    await Promise.resolve();
    expect(handleCommand).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
