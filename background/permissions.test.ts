import { afterEach, describe, expect, test, vi } from "vitest";

import { providerCatalog } from "../providers/catalog";
import {
  hasProviderPermission,
  permissionChangeAffectsProvider,
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

  test("requests and checks only the configured New API instance origin", async () => {
    const request = vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    const contains = vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);

    await requestProviderPermission("newapi", {
      baseUrl: "https://api.example.com/new-api/v1/messages",
    });
    await hasProviderPermission("newapi", {
      baseUrl: "https://api.example.com/new-api",
    });

    expect(request).toHaveBeenCalledWith({ origins: ["https://api.example.com/*"] });
    expect(contains).toHaveBeenCalledWith({ origins: ["https://api.example.com/*"] });
  });

  test("fails closed when dynamic New API permission has no safe base URL", async () => {
    const request = vi.spyOn(browser.permissions, "request");

    await expect(requestProviderPermission("newapi")).resolves.toBe(false);
    await expect(
      requestProviderPermission("newapi", { baseUrl: "http://public.example.com" }),
    ).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  test("maps only supported exact dynamic origins to New API permission changes", () => {
    expect(
      permissionChangeAffectsProvider("newapi", {
        origins: ["https://api.example.com/*"],
      }),
    ).toBe(true);
    expect(
      permissionChangeAffectsProvider("newapi", {
        origins: ["http://localhost:3000/*"],
      }),
    ).toBe(true);
    expect(
      permissionChangeAffectsProvider("newapi", {
        origins: ["http://public.example.com/*"],
      }),
    ).toBe(false);
    expect(
      permissionChangeAffectsProvider("newapi", {
        origins: ["https://chatgpt.com/*"],
      }),
    ).toBe(false);
    expect(
      permissionChangeAffectsProvider("chatgpt", {
        origins: ["https://api.example.com/*"],
      }),
    ).toBe(false);
  });

  test("removes only the disconnected provider's exact optional access", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
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
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(async () => true as never);
    const catalog = {
      ...providerCatalog,
      cursor: {
        ...providerCatalog.cursor,
        optionalPermissions: ["cookies"],
      },
    };

    await removeProviderPermission("kimi", ["cursor"], catalog);

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://www.kimi.com/*"],
      permissions: ["scripting"],
    });
  });

  test("returns false when Chrome refuses exact permission removal", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "remove").mockImplementation(
      async () => false as never,
    );

    await expect(removeProviderPermission("chatgpt", [])).resolves.toBe(false);
  });

  test("attempts idempotent removal and treats an absent exact postcondition as success", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockResolvedValue(false as never);

    await expect(removeProviderPermission("elevenlabs", [])).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://api.elevenlabs.io/*"],
    });
  });

  test("removes only the stored New API instance permission", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    const remove = vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);

    await expect(
      removeProviderPermission("newapi", [], providerCatalog, {
        baseUrl: "https://api.example.com/new-api",
      }),
    ).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith({ origins: ["https://api.example.com/*"] });
  });

  test("uses the absent postcondition when Chrome returns false from removal", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);

    await expect(removeProviderPermission("elevenlabs", [])).resolves.toBe(true);
  });

  test("uses the absent postcondition when Chrome rejects removal", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions, "remove").mockRejectedValue(
      new Error("permission service unavailable"),
    );

    await expect(removeProviderPermission("elevenlabs", [])).resolves.toBe(true);
  });

  test("reports failure when exact permission remains after Chrome returns true", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);

    await expect(removeProviderPermission("elevenlabs", [])).resolves.toBe(false);
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

  test("removes an orphaned exact New API origin during delete-all", async () => {
    vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
      origins: ["https://self-hosted.example.com/*"],
      permissions: [],
    } as never);
    const remove = vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);

    await expect(removeAllProviderPermissions(["newapi"])).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://self-hosted.example.com/*"],
    });
  });
});
