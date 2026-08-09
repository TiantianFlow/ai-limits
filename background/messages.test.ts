import { describe, expect, test, vi } from "vitest";

import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
  isProviderOperationEvent,
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
      setAutoRefresh: vi.fn(async () => "auto-updated"),
      disconnectProvider: vi.fn(async () => "disconnected"),
      deleteLocalData: vi.fn(async () => "deleted"),
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
    await expect(
      handle({ type: "SET_AUTO_REFRESH", enabled: false }),
    ).resolves.toBe("auto-updated");
    await expect(
      handle({ type: "SET_AUTO_REFRESH", enabled: true }),
    ).resolves.toBe("auto-updated");
    await expect(
      handle({ type: "DISCONNECT_PROVIDER", providerId: "kimi" }),
    ).resolves.toBe("disconnected");
    await expect(handle({ type: "DELETE_LOCAL_DATA" })).resolves.toBe("deleted");
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
    expect(
      handle({ type: "SET_AUTO_REFRESH", enabled: "false" }),
    ).toBeUndefined();
    expect(
      handle({ type: "SET_AUTO_REFRESH", enabled: false, extra: true }),
    ).toBeUndefined();
    expect(
      handle({ type: "DISCONNECT_PROVIDER", providerId: "antigravity" }),
    ).toBeUndefined();
    expect(
      handle({ type: "DELETE_LOCAL_DATA", providerId: "chatgpt" }),
    ).toBeUndefined();
    expect(handlers.refreshAll).toHaveBeenCalledTimes(1);
    expect(handlers.collectProvider).toHaveBeenCalledTimes(4);
    expect(handlers.refreshProvider).toHaveBeenCalledTimes(1);
    expect(handlers.refreshProvider).toHaveBeenCalledWith("kimi");
    expect(handlers.getState).toHaveBeenCalledTimes(1);
    expect(handlers.setDisplayMode).toHaveBeenNthCalledWith(1, "used");
    expect(handlers.setDisplayMode).toHaveBeenNthCalledWith(2, "left");
    expect(handlers.setAutoRefresh).toHaveBeenNthCalledWith(1, false);
    expect(handlers.setAutoRefresh).toHaveBeenNthCalledWith(2, true);
    expect(handlers.disconnectProvider).toHaveBeenCalledWith("kimi");
    expect(handlers.deleteLocalData).toHaveBeenCalledTimes(1);
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

  test("accepts only the exact credential-free Kimi operation event", () => {
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        providerId: "kimi",
        operation: "waiting_for_session",
      }),
    ).toBe(true);
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        providerId: "kimi",
        operation: "waiting_for_session",
        accessToken: "secret",
      }),
    ).toBe(false);
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        providerId: "claude",
        operation: "waiting_for_session",
      }),
    ).toBe(false);
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        providerId: "kimi",
        operation: "fetching",
      }),
    ).toBe(false);
  });
});
