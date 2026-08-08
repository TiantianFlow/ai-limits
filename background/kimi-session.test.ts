import { describe, expect, test, vi } from "vitest";

import { findKimiPageAccessToken } from "./kimi-session";

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
});
