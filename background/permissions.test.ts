import { afterEach, describe, expect, test, vi } from "vitest";

import { providerRegistry } from "../providers/registry";
import {
  hasProviderPermission,
  removeAllProviderPermissions,
  removeProviderPermission,
  requestProviderPermission,
} from "./permissions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider permissions", () => {
  test.each([
    ["chatgpt", { origins: ["https://chatgpt.com/*"] }],
    ["claude", { origins: ["https://claude.ai/*"] }],
    [
      "kimi",
      {
        origins: ["https://www.kimi.com/*"],
        permissions: ["cookies", "scripting"],
      },
    ],
    ["cursor", { origins: ["https://cursor.com/*"] }],
  ] as const)("requests only %s's exact optional permissions", async (providerId, expected) => {
    const request = vi
      .spyOn(browser.permissions, "request")
      .mockResolvedValue(undefined);

    await requestProviderPermission(providerId);

    expect(request).toHaveBeenCalledWith(expected);
  });

  test("checks only the selected provider's exact optional permissions", async () => {
    const contains = vi
      .spyOn(browser.permissions, "contains")
      .mockResolvedValue(undefined);

    await hasProviderPermission("kimi");

    expect(contains).toHaveBeenCalledWith({
      origins: ["https://www.kimi.com/*"],
      permissions: ["cookies", "scripting"],
    });
  });

  test("removes only the disconnected provider's exact optional access", async () => {
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(async () => true as never);

    await expect(removeProviderPermission("kimi", [])).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://www.kimi.com/*"],
      permissions: ["cookies", "scripting"],
    });
  });

  test("preserves optional API permissions required by a remaining connected provider", async () => {
    const cursor = providerRegistry.cursor as unknown as {
      optionalPermissions?: readonly string[];
    };
    const originalPermissions = cursor.optionalPermissions;
    cursor.optionalPermissions = ["cookies"];
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(async () => true as never);

    try {
      await removeProviderPermission("kimi", ["cursor"]);
    } finally {
      cursor.optionalPermissions = originalPermissions;
    }

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://www.kimi.com/*"],
      permissions: ["scripting"],
    });
  });

  test("returns false when Chrome refuses exact permission removal", async () => {
    vi.spyOn(browser.permissions, "remove").mockImplementation(
      async () => false as never,
    );

    await expect(removeProviderPermission("chatgpt", [])).resolves.toBe(false);
  });

  test("removes partial provider permissions that do not satisfy the full grant", async () => {
    vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
      origins: [],
      permissions: ["cookies"],
    } as never);
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(async () => true as never);

    await expect(removeAllProviderPermissions(["kimi"])).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith({ permissions: ["cookies"] });
  });

  test("attempts every provider permission cleanup when one removal rejects", async () => {
    vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
      origins: ["https://chatgpt.com/*", "https://claude.ai/*"],
      permissions: [],
    } as never);
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockRejectedValueOnce(new Error("Chrome unavailable"))
      .mockImplementationOnce(async () => true as never);

    await expect(
      removeAllProviderPermissions(["chatgpt", "claude"]),
    ).resolves.toBe(false);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, {
      origins: ["https://chatgpt.com/*"],
    });
    expect(remove).toHaveBeenNthCalledWith(2, {
      origins: ["https://claude.ai/*"],
    });
  });
});
