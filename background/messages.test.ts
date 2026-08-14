import { describe, expect, test, vi } from "vitest";

import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
  isProviderOperationEvent,
  isRuntimeCommand,
} from "./messages";

const INSTANCE = "newapi:550e8400-e29b-41d4-a716-446655440000";

describe("strict instance runtime protocol", () => {
  test("dispatches every exact command shape with instance identity intact", async () => {
    const handlers = {
      refreshAll: vi.fn(async () => "all"),
      connectBrowserProvider: vi.fn(async () => "browser"),
      connectApiKeyProvider: vi.fn(async () => "api"),
      refreshInstance: vi.fn(async () => "one"),
      renameInstance: vi.fn(async () => "renamed"),
      disconnectInstance: vi.fn(async () => "disconnected"),
      getState: vi.fn(async () => "state"),
      setDisplayMode: vi.fn(async () => "display"),
      setAutoRefresh: vi.fn(async () => "auto"),
      deleteLocalData: vi.fn(async () => "deleted"),
    };
    const handle = createRuntimeCommandHandler(handlers);

    await expect(handle({ type: "REFRESH_ALL" })).resolves.toBe("all");
    await expect(
      handle({ type: "CONNECT_BROWSER_PROVIDER", providerKind: "kimi" }),
    ).resolves.toBe("browser");
    const apiCommand = {
      type: "CONNECT_API_KEY_PROVIDER" as const,
      providerKind: "newapi" as const,
      instanceId: INSTANCE,
      userLabel: "Work relay",
      config: { kind: "dynamic-origin" as const, baseUrl: "https://relay.example/path" },
      apiKey: "synthetic-candidate-key",
    };
    await expect(handle(apiCommand)).resolves.toBe("api");
    await expect(
      handle({ type: "REFRESH_INSTANCE", instanceId: INSTANCE }),
    ).resolves.toBe("one");
    await expect(
      handle({ type: "RENAME_INSTANCE", instanceId: INSTANCE, userLabel: "Renamed" }),
    ).resolves.toBe("renamed");
    await expect(
      handle({ type: "RENAME_INSTANCE", instanceId: INSTANCE }),
    ).resolves.toBe("renamed");
    await expect(
      handle({ type: "DISCONNECT_INSTANCE", instanceId: INSTANCE }),
    ).resolves.toBe("disconnected");
    await expect(handle({ type: "GET_STATE" })).resolves.toBe("state");
    await expect(handle({ type: "SET_DISPLAY_MODE", mode: "left" })).resolves.toBe("display");
    await expect(handle({ type: "SET_AUTO_REFRESH", enabled: false })).resolves.toBe("auto");
    await expect(handle({ type: "DELETE_LOCAL_DATA" })).resolves.toBe("deleted");

    expect(handlers.connectBrowserProvider).toHaveBeenCalledWith("kimi");
    expect(handlers.connectApiKeyProvider).toHaveBeenCalledWith(apiCommand);
    expect(handlers.refreshInstance).toHaveBeenCalledWith(INSTANCE);
    expect(handlers.renameInstance).toHaveBeenNthCalledWith(1, INSTANCE, "Renamed");
    expect(handlers.renameInstance).toHaveBeenNthCalledWith(2, INSTANCE, undefined);
    expect(handlers.disconnectInstance).toHaveBeenCalledWith(INSTANCE);
  });

  test.each([
    { type: "REFRESH_ALL", apiKey: "secret" },
    { type: "GET_STATE", credential: "secret" },
    { type: "REFRESH_PROVIDER", providerId: "kimi" },
    { type: "DISCONNECT_PROVIDER", providerId: "kimi" },
    { type: "CONNECT_BROWSER_PROVIDER", providerKind: "elevenlabs" },
    { type: "REFRESH_INSTANCE", instanceId: "newapi:not-a-uuid" },
    { type: "REFRESH_INSTANCE", instanceId: INSTANCE, token: "secret" },
    { type: "RENAME_INSTANCE", instanceId: INSTANCE, userLabel: "x".repeat(129) },
    { type: "RENAME_INSTANCE", instanceId: INSTANCE, userLabel: "bad\u0000label" },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: " ",
    },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "http://public.example" },
      apiKey: "secret",
    },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "elevenlabs",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: "secret",
    },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: "x".repeat(4_097),
    },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: "secret",
      password: "unexpected-secret",
    },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "newapi",
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://relay.example",
        accessToken: "nested-secret",
      },
      apiKey: "secret",
    },
    {
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "elevenlabs",
      config: { kind: "fixed", password: "nested-secret" },
      apiKey: "secret",
    },
  ])("rejects malformed, legacy, or secret-extended command %#", (command) => {
    expect(isRuntimeCommand(command)).toBe(false);
  });

  test("normalizes command configuration only through the provider package contract", () => {
    expect(
      isRuntimeCommand({
        type: "CONNECT_API_KEY_PROVIDER",
        providerKind: "newapi",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example/v1" },
        apiKey: "synthetic-key",
      }),
    ).toBe(true);
    expect(
      isRuntimeCommand({
        type: "CONNECT_API_KEY_PROVIDER",
        providerKind: "elevenlabs",
        config: { kind: "fixed" },
        apiKey: "synthetic-key",
      }),
    ).toBe(true);
  });

  test("keeps the response channel open only for accepted commands", async () => {
    const handleCommand = vi.fn(async () => ({ version: 1 }));
    const sendResponse = vi.fn();
    const listener = createChromeRuntimeMessageListener(handleCommand);

    expect(listener({ type: "GET_STATE" }, {} as never, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ version: 1 }));

    handleCommand.mockClear();
    sendResponse.mockClear();
    expect(
      listener({ type: "GET_STATE", token: "secret" }, {} as never, sendResponse),
    ).toBe(false);
    expect(handleCommand).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test("returns a fixed failure envelope without echoing commands or internal errors", async () => {
    const handleCommand = vi.fn(async () => {
      throw new Error("internal-secret");
    });
    const sendResponse = vi.fn();
    const listener = createChromeRuntimeMessageListener(handleCommand);

    expect(
      listener(
        {
          type: "CONNECT_API_KEY_PROVIDER",
          providerKind: "elevenlabs",
          config: { kind: "fixed" },
          apiKey: "candidate-secret",
        },
        {} as never,
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "command_failed" }),
    );
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain("internal-secret");
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain("candidate-secret");
  });

  test("accepts only credential-free instance operation events", () => {
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        instanceId: "kimi:default",
        operation: "waiting_for_session",
      }),
    ).toBe(true);
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        instanceId: "kimi:default",
        operation: "waiting_for_session",
        accessToken: "secret",
      }),
    ).toBe(false);
    expect(
      isProviderOperationEvent({
        type: "PROVIDER_OPERATION",
        instanceId: "kimi:not-valid",
        operation: "waiting_for_session",
      }),
    ).toBe(false);
  });
});
