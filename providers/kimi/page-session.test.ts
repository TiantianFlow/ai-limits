import { describe, expect, test, vi } from "vitest";

import {
  readKimiAccessTokenAtExpectedOrigin,
  readKimiPageAccessToken,
} from "./page-session";

describe("Kimi page credential isolation", () => {
  test("reads the exact key only when the executing page is still on Kimi", () => {
    const storage = { getItem: vi.fn(() => "kimi-token") };

    expect(
      readKimiAccessTokenAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://www.kimi.com",
      ),
    ).toBe("kimi-token");
    expect(storage.getItem).toHaveBeenCalledWith("access_token");
  });

  test("does not touch storage after a selected tab navigates to another origin", () => {
    const storage = { getItem: vi.fn(() => "other-provider-token") };

    expect(
      readKimiAccessTokenAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://chatgpt.com",
      ),
    ).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  test("binds the injected read to the expected Kimi origin", async () => {
    const executeScript = vi.fn(async (details) => {
      expect(details.target).toEqual({ tabId: 42 });
      expect(details.world).toBe("MAIN");
      expect(details.args).toEqual(["https://www.kimi.com"]);
      return [{ result: undefined }];
    });

    await expect(
      readKimiPageAccessToken(42, executeScript),
    ).resolves.toBeUndefined();
    expect(executeScript).toHaveBeenCalledOnce();
  });
});
