import { describe, expect, test, vi } from "vitest";

import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
} from "./messages";

describe("runtime command router", () => {
  test("dispatches only the exact fixed command shapes", async () => {
    const handlers = {
      refreshAll: vi.fn(async () => "refreshed"),
      connectProvider: vi.fn(async () => "connected"),
      getState: vi.fn(async () => "state"),
    };
    const handle = createRuntimeCommandHandler(handlers);

    await expect(handle({ type: "REFRESH_ALL" })).resolves.toBe("refreshed");
    await expect(
      handle({ type: "CONNECT_PROVIDER", providerId: "chatgpt" }),
    ).resolves.toBe("connected");
    await expect(
      handle({ type: "CONNECT_PROVIDER", providerId: "claude" }),
    ).resolves.toBe("connected");
    await expect(
      handle({ type: "CONNECT_PROVIDER", providerId: "kimi" }),
    ).resolves.toBe("connected");
    await expect(
      handle({ type: "CONNECT_PROVIDER", providerId: "cursor" }),
    ).resolves.toBe("connected");
    await expect(handle({ type: "GET_STATE" })).resolves.toBe("state");
    expect(handlers.connectProvider).toHaveBeenNthCalledWith(1, "chatgpt");

    expect(handle({ type: "FETCH", url: "https://attacker.invalid" })).toBeUndefined();
    expect(
      handle({
        type: "REFRESH_ALL",
        url: "https://attacker.invalid",
      }),
    ).toBeUndefined();
    expect(
      handle({ type: "CONNECT_PROVIDER", providerId: "antigravity" }),
    ).toBeUndefined();
    expect(
      handle({
        type: "CONNECT_PROVIDER",
        providerId: "claude",
        extra: true,
      }),
    ).toBeUndefined();
    expect(handlers.refreshAll).toHaveBeenCalledTimes(1);
    expect(handlers.connectProvider).toHaveBeenCalledTimes(4);
    expect(handlers.getState).toHaveBeenCalledTimes(1);
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
