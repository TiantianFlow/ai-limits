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
        true,
      ),
    ).toBe("kimi-token");
    expect(storage.getItem).toHaveBeenCalledWith("access_token");
  });

  test("does not read storage until Kimi's client app has mounted", () => {
    const storage = { getItem: vi.fn(() => "stale-token") };

    expect(
      readKimiAccessTokenAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://www.kimi.com",
        false,
      ),
    ).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  test("uses the page mount flag when the caller does not pass one", () => {
    const storage = { getItem: vi.fn(() => "kimi-token") };
    const host = globalThis as { __kimiAppMounted?: unknown };
    const previous = host.__kimiAppMounted;
    host.__kimiAppMounted = true;

    try {
      expect(
        readKimiAccessTokenAtExpectedOrigin(
          "https://www.kimi.com",
          storage,
          "https://www.kimi.com",
        ),
      ).toBe("kimi-token");
    } finally {
      if (previous === undefined) delete host.__kimiAppMounted;
      else host.__kimiAppMounted = previous;
    }
  });

  test("does not touch storage after a selected tab navigates to another origin", () => {
    const storage = { getItem: vi.fn(() => "other-provider-token") };

    expect(
      readKimiAccessTokenAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://chatgpt.com",
        true,
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
