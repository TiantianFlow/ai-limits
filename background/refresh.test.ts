import { describe, expect, test, vi } from "vitest";

import { refreshGrantedProviders } from "./refresh";

describe("refreshGrantedProviders", () => {
  test("attempts every and only granted provider and isolates collection failures", async () => {
    const hasPermission = vi.fn(async (providerId: string) =>
      providerId === "chatgpt" || providerId === "cursor",
    );
    const collect = vi.fn(async (providerId: string) => {
      if (providerId === "chatgpt") throw new Error("unavailable");
    });

    await expect(
      refreshGrantedProviders(["chatgpt", "claude", "kimi", "cursor"], hasPermission, collect),
    ).resolves.toBeUndefined();

    expect(hasPermission).toHaveBeenCalledTimes(4);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(collect).toHaveBeenCalledWith("chatgpt");
    expect(collect).toHaveBeenCalledWith("cursor");
  });
});
