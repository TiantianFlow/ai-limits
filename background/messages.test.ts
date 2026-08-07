import { describe, expect, test, vi } from "vitest";

import { createRuntimeCommandHandler } from "./messages";

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
    await expect(handle({ type: "GET_STATE" })).resolves.toBe("state");
    expect(handlers.connectProvider).toHaveBeenCalledWith("chatgpt");

    expect(handle({ type: "FETCH", url: "https://attacker.invalid" })).toBeUndefined();
    expect(
      handle({
        type: "REFRESH_ALL",
        url: "https://attacker.invalid",
      }),
    ).toBeUndefined();
    expect(handlers.refreshAll).toHaveBeenCalledTimes(1);
    expect(handlers.connectProvider).toHaveBeenCalledTimes(1);
    expect(handlers.getState).toHaveBeenCalledTimes(1);
  });
});
