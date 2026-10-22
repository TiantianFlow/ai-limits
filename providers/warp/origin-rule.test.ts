import { describe, expect, test, vi } from "vitest";
import {
  installWarpOriginRule,
  WARP_ORIGIN_RULE_ID,
  WARP_USAGE_URL,
} from "./origin-rule";

describe("Warp origin rule", () => {
  test("replaces one session rule that strips Origin from the usage request only", async () => {
    const updateSessionRules = vi.fn(async () => {});

    await installWarpOriginRule({ updateSessionRules }, "extension-id");

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [WARP_ORIGIN_RULE_ID],
      addRules: [
        {
          id: WARP_ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "origin", operation: "remove" }],
          },
          condition: {
            urlFilter:
              "|https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo|",
            requestMethods: ["post"],
            resourceTypes: ["xmlhttprequest"],
            initiatorDomains: ["extension-id"],
            tabIds: [-1],
          },
        },
      ],
    });
    expect(WARP_USAGE_URL).toBe(
      "https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo",
    );
  });
});
