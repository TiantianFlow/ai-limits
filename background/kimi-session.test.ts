import { describe, expect, test, vi } from "vitest";

import {
  findKimiPageAccessToken,
  refreshKimiAccessTokenInTemporaryTab,
} from "./kimi-session";

describe("Kimi page session", () => {
  test("returns the first non-empty token from an already-open Kimi tab", async () => {
    const readAccessToken = vi.fn(async (tabId: number) => {
      if (tabId === 7) throw new Error("tab closed during inspection");
      return tabId === 9 ? "  page-token  " : undefined;
    });

    await expect(
      findKimiPageAccessToken({
        queryTabs: async () => [{ id: 7 }, { id: undefined }, { id: 9 }],
        readAccessToken,
      }),
    ).resolves.toBe("page-token");
  });

  test("returns undefined when no open tab exposes a token", async () => {
    await expect(
      findKimiPageAccessToken({
        queryTabs: async () => [{ id: 4 }],
        readAccessToken: async () => "   ",
      }),
    ).resolves.toBeUndefined();
  });

  test("returns a changed token from a new inactive tab and closes that tab", async () => {
    const reads = [undefined, " stale-token ", " fresh-token "];
    const createTab = vi.fn().mockResolvedValue({ id: 42 });
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await expect(
      refreshKimiAccessTokenInTemporaryTab({
        staleAccessToken: "stale-token",
        createTab,
        readAccessToken: vi.fn(async () => reads.shift()),
        removeTab,
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe("fresh-token");

    expect(createTab).toHaveBeenCalledWith({
      url: "https://www.kimi.com/",
      active: false,
    });
    expect(removeTab).toHaveBeenCalledWith(42);
  });

  test("fails fast after twenty unchanged reads and closes the temporary tab", async () => {
    const readAccessToken = vi.fn().mockResolvedValue("stale-token");
    const wait = vi.fn().mockResolvedValue(undefined);
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await expect(
      refreshKimiAccessTokenInTemporaryTab({
        staleAccessToken: "stale-token",
        createTab: vi.fn().mockResolvedValue({ id: 17 }),
        readAccessToken,
        removeTab,
        wait,
      }),
    ).resolves.toBeUndefined();

    expect(readAccessToken).toHaveBeenCalledTimes(20);
    expect(wait).toHaveBeenCalledTimes(19);
    expect(wait).toHaveBeenCalledWith(250);
    expect(removeTab).toHaveBeenCalledWith(17);
  });

  test("stops polling when collection is aborted and still closes its tab", async () => {
    const controller = new AbortController();
    const readAccessToken = vi.fn().mockResolvedValue(undefined);
    const removeTab = vi.fn().mockResolvedValue(undefined);

    await expect(
      refreshKimiAccessTokenInTemporaryTab({
        staleAccessToken: "stale-token",
        createTab: vi.fn().mockResolvedValue({ id: 23 }),
        readAccessToken,
        removeTab,
        signal: controller.signal,
        wait: vi.fn(async () => controller.abort()),
      }),
    ).resolves.toBeUndefined();

    expect(readAccessToken).toHaveBeenCalledTimes(1);
    expect(removeTab).toHaveBeenCalledWith(23);
  });

  test(
    "aborts a pending token read and closes the temporary tab",
    async () => {
      const controller = new AbortController();
      const removeTab = vi.fn().mockResolvedValue(undefined);

      const result = refreshKimiAccessTokenInTemporaryTab({
        staleAccessToken: "stale-token",
        createTab: vi.fn().mockResolvedValue({ id: 29 }),
        readAccessToken: vi.fn(() => {
          queueMicrotask(() => controller.abort());
          return new Promise(() => undefined);
        }),
        removeTab,
        signal: controller.signal,
        wait: vi.fn().mockResolvedValue(undefined),
      });

      await expect(result).resolves.toBeUndefined();
      expect(removeTab).toHaveBeenCalledWith(29);
    },
    200,
  );

  test("times out a pending token read at the five-second recovery boundary", async () => {
    vi.useFakeTimers();
    const removeTab = vi.fn().mockResolvedValue(undefined);

    try {
      const result = refreshKimiAccessTokenInTemporaryTab({
        staleAccessToken: "stale-token",
        createTab: vi.fn().mockResolvedValue({ id: 30 }),
        readAccessToken: vi.fn(() => new Promise(() => undefined)),
        removeTab,
        wait: vi.fn().mockResolvedValue(undefined),
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(removeTab).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBeUndefined();
      expect(removeTab).toHaveBeenCalledWith(30);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not lose a refreshed token when the temporary tab was already closed", async () => {
    await expect(
      refreshKimiAccessTokenInTemporaryTab({
        staleAccessToken: "stale-token",
        createTab: vi.fn().mockResolvedValue({ id: 31 }),
        readAccessToken: vi.fn().mockResolvedValue("fresh-token"),
        removeTab: vi.fn().mockRejectedValue(new Error("No tab with id: 31")),
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe("fresh-token");
  });
});
