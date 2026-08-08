import { afterEach, describe, expect, test, vi } from "vitest";

import {
  hasProviderPermission,
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
      { origins: ["https://www.kimi.com/*"], permissions: ["cookies"] },
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
      permissions: ["cookies"],
    });
  });
});
