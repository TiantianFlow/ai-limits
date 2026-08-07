import { afterEach, describe, expect, test, vi } from "vitest";

import { requestProviderPermission } from "./permissions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider permissions", () => {
  test("requests only the exact optional ChatGPT origin", async () => {
    const request = vi
      .spyOn(browser.permissions, "request")
      .mockResolvedValue(undefined);

    await requestProviderPermission("chatgpt");
    expect(request).toHaveBeenCalledWith({
      origins: ["https://chatgpt.com/*"],
    });
  });
});
