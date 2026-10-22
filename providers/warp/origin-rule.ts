// Warp's app server answers 403 to any request carrying an Origin header,
// and Chrome stamps extension fetches with `Origin: chrome-extension://<id>`.
// This session rule removes that header from AI Limits' own usage request and
// nothing else: one exact URL, POST only, from this extension's service worker.
// It takes effect only while the optional app.warp.dev host access is granted.

export const WARP_ORIGIN_RULE_ID = 1;
export const WARP_USAGE_URL =
  "https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo";

type SessionRulesApi = Pick<
  typeof browser.declarativeNetRequest,
  "updateSessionRules"
>;

export function warpOriginRule(
  extensionId: string,
): Browser.declarativeNetRequest.Rule {
  return {
    id: WARP_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "remove" }],
    },
    condition: {
      urlFilter: `|${WARP_USAGE_URL}|`,
      requestMethods: ["post"],
      resourceTypes: ["xmlhttprequest"],
      initiatorDomains: [extensionId],
      // Service-worker requests have no tab.
      tabIds: [-1],
    },
  };
}

export async function installWarpOriginRule(
  api: SessionRulesApi = browser.declarativeNetRequest,
  extensionId: string = browser.runtime.id,
): Promise<void> {
  await api.updateSessionRules({
    removeRuleIds: [WARP_ORIGIN_RULE_ID],
    addRules: [warpOriginRule(extensionId)],
  });
}
