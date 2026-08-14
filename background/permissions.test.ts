import { afterEach, describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../domain/instances";
import {
  hasInstancePermission,
  permissionChangeAffectsInstance,
  removeAllInstancePermissions,
  removeUnusedInstancePermissions,
  requestInstancePermission,
  requiredPermissionsForInstance,
} from "./permissions";

const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";

function instance(
  id: string,
  baseUrl = "https://relay.example",
): ProviderInstanceRecord {
  return {
    id,
    providerKind: "newapi",
    config: { kind: "dynamic-origin", baseUrl },
    access: "granted",
    createdAt: 1,
    history: [],
  };
}

const kimi: ProviderInstanceRecord = {
  id: "kimi:default",
  providerKind: "kimi",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: 1,
  history: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("instance permission ownership", () => {
  test("derives exact requirements through the selected package", () => {
    expect(requiredPermissionsForInstance(instance(FIRST))).toEqual({
      origins: ["https://relay.example/*"],
    });
    expect(requiredPermissionsForInstance(kimi)).toEqual({
      origins: ["https://www.kimi.com/*"],
      permissions: ["cookies", "scripting"],
    });
  });

  test("requests and checks only one instance's normalized requirements", async () => {
    const request = vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    const contains = vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    const target = instance(FIRST, "https://relay.example/path");

    await expect(requestInstancePermission(target)).resolves.toBe(true);
    await expect(hasInstancePermission(target)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith({ origins: ["https://relay.example/*"] });
    expect(contains).toHaveBeenCalledWith({ origins: ["https://relay.example/*"] });
  });

  test("disconnecting one same-origin sibling preserves their shared grant", async () => {
    const remove = vi.spyOn(browser.permissions, "remove");

    await expect(
      removeUnusedInstancePermissions(instance(FIRST), [instance(SECOND)]),
    ).resolves.toBe(true);

    expect(remove).not.toHaveBeenCalled();
  });

  test("disconnecting the last same-origin owner removes the exact grant", async () => {
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);

    await expect(
      removeUnusedInstancePermissions(instance(FIRST), []),
    ).resolves.toBe(true);

    expect(browser.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
  });

  test("different-origin instances are removed independently", async () => {
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);

    await removeUnusedInstancePermissions(instance(FIRST), [
      instance(SECOND, "https://other.example"),
    ]);

    expect(browser.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
  });

  test("preserves a shared API permission while removing an unowned origin", async () => {
    const syntheticSibling: ProviderInstanceRecord = {
      ...kimi,
      id: "chatgpt:default",
      providerKind: "chatgpt",
    };
    const packages = {
      kimi: {
        requiredPermissions: () => ({
          origins: ["https://www.kimi.com/*"],
          permissions: ["cookies", "scripting"],
        }),
      },
      chatgpt: {
        requiredPermissions: () => ({
          origins: ["https://chatgpt.com/*"],
          permissions: ["cookies"],
        }),
      },
    } as never;
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);

    await removeUnusedInstancePermissions(kimi, [syntheticSibling], packages);

    expect(browser.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://www.kimi.com/*"],
      permissions: ["scripting"],
    });
  });

  test("maps permission changes to every exact owning instance and no unrelated instance", () => {
    expect(
      permissionChangeAffectsInstance(instance(FIRST), {
        origins: ["https://relay.example/*"],
      }),
    ).toBe(true);
    expect(
      permissionChangeAffectsInstance(instance(SECOND), {
        origins: ["https://relay.example/*"],
      }),
    ).toBe(true);
    expect(
      permissionChangeAffectsInstance(
        instance(SECOND, "https://other.example"),
        { origins: ["https://relay.example/*"] },
      ),
    ).toBe(false);
    expect(
      permissionChangeAffectsInstance(kimi, { permissions: ["cookies"] }),
    ).toBe(true);
  });

  test("delete-all removes only the union of active instance requirements", async () => {
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);

    await expect(
      removeAllInstancePermissions([instance(FIRST), instance(SECOND), kimi]),
    ).resolves.toBe(true);

    expect(browser.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*", "https://www.kimi.com/*"],
      permissions: ["cookies", "scripting"],
    });
  });

  test("permission cleanup reports failure when Chrome still contains the exact grant", async () => {
    vi.spyOn(browser.permissions, "remove").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);

    await expect(removeUnusedInstancePermissions(instance(FIRST), [])).resolves.toBe(false);
  });

  test("permission cleanup contains a failed exact postcondition check", async () => {
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions, "contains").mockRejectedValue(
      new Error("permissions API unavailable"),
    );

    await expect(
      removeUnusedInstancePermissions(instance(FIRST), []),
    ).resolves.toBe(false);
  });
});
