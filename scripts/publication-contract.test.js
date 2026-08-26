import { describe, expect, it } from "vitest";
import { validatePublicationDocuments } from "./publication-contract.mjs";

const issuesUrl = "https://github.com/TiantianFlow/ai-limits/issues";
const issuesLink = `[GitHub Issues](${issuesUrl})`;
const supportedProvidersUrl =
  "https://github.com/TiantianFlow/ai-limits/blob/main/SUPPORTED_PROVIDERS.md";
const supportedProvidersUrlZh =
  "https://github.com/TiantianFlow/ai-limits/blob/main/SUPPORTED_PROVIDERS.zh-CN.md";
const storeUrl =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";
const storeLink = `[Chrome Web Store](${storeUrl})`;
const releaseUrl = "https://github.com/TiantianFlow/ai-limits/releases/latest";
const releaseLink = `[GitHub release](${releaseUrl})`;
const faqLink = "[FAQ](FAQ.md)";
const releaseChannelStatement =
  "Chrome Web Store releases can lag while review or publishing is pending; the Store badge shows the currently published version.";
const releaseChannelStatementZh =
  "Chrome 应用商店版本可能因审核或发布流程而滞后；应用商店徽章显示当前已发布的版本。";
const historyRetentionStatement =
  "Successful normalized quota, counter or spend, and balance observations are stored per instance for up to 30 days, subject to a 1,024-observation per-instance safety cap.";
const uncappedHistoryRetentionStatement =
  "Successful normalized quota, counter or spend, and balance observations are stored per instance for up to 30 days.";
const securityCondition =
  "If GitHub private vulnerability reporting is available in the repository's **Security** tab, use it for sensitive reports.";
const securityFallback =
  "If that feature is unavailable, open a minimal issue requesting a private contact route without disclosing the vulnerability or sensitive details.";
const credentialBoundaryStatement =
  "Background command responses and application state never include saved API keys, and AI Limits does not render them or copy them into reports, logs, or History.";
const publicRouteGate =
  "After the repository is public and before Chrome Web Store submission, verify the homepage, privacy policy, and support URLs are reachable in a signed-out browser.";
const paceAvailabilityStatement =
  "For quota windows with a reliable reset time plus either a start time or window duration, a pace signal compares quota consumed with elapsed time.";
const storeShortDescription =
  "Track subscription usage, resets, pace, and local history for your connected AI providers in one Chrome side panel.";
const kimiAutoRefreshStatement =
  "Kimi automatic refresh is best-effort and may not always work; a manual Connect or Refresh may briefly open an inactive Kimi tab in the background to recover the session.";
const kimiAutoRefreshStatementZh =
  "Kimi 自动刷新属于尽力而为，并不保证每次都能成功；手动 Connect 或 Refresh 可能会在后台短暂打开一个非活动 Kimi 标签页以恢复会话。";
const elevenLabsPublicationStatements = [
  {
    key: "readme",
    statement:
      "AI Limits supports twenty providers: ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, Perplexity, ElevenLabs, New API, LiteLLM, ClawRouter, sub2api, LLM Proxy, DeepSeek, Moonshot, DeepInfra, Fireworks, OpenAI, GroqCloud, and OpenRouter.",
    error: "README is missing the rendered twenty-provider statement.",
  },
  {
    key: "readmeZh",
    statement:
      "AI Limits 支持二十个服务：ChatGPT、Claude、Kimi、Cursor、Grok、Mistral、Perplexity、ElevenLabs、New API、LiteLLM、ClawRouter、sub2api、LLM Proxy、DeepSeek、Moonshot、DeepInfra、Fireworks、OpenAI、GroqCloud 和 OpenRouter。",
    error:
      "Simplified Chinese README is missing the rendered twenty-provider statement.",
  },
  {
    key: "faq",
    statement:
      "ElevenLabs uses a user-created API key; after a successful check, AI Limits stores it locally and scheduled refresh does not open an ElevenLabs tab.",
    error:
      "English FAQ is missing the rendered ElevenLabs connection and refresh statement.",
  },
  {
    key: "faqZh",
    statement:
      "ElevenLabs 使用由用户创建的 API 密钥；验证成功后，AI Limits 会将其保存在本地，定时刷新不会打开 ElevenLabs 标签页。",
    error:
      "Simplified Chinese FAQ is missing the rendered ElevenLabs connection and refresh statement.",
  },
  {
    key: "privacy",
    statement:
      "API keys are stored separately in chrome.storage.local, which AI Limits restricts to trusted extension contexts through Chrome's storage access level.",
    error:
      "Privacy policy is missing the trusted-context ElevenLabs key-storage disclosure.",
  },
  {
    key: "privacy",
    statement:
      "AI Limits sends the saved key only to https://api.elevenlabs.io as the xi-api-key header for the read-only subscription request.",
    error:
      "Privacy policy is missing the exact ElevenLabs key destination disclosure.",
  },
  {
    key: "privacy",
    statement:
      "The saved key is not OS-keychain encrypted and may be inspectable by someone with access to the unlocked Chrome profile, extension DevTools, or profile files.",
    error:
      "Privacy policy is missing the local API-key inspection limitation.",
  },
  {
    key: "privacy",
    statement:
      "The saved key is never included in usage state, History, screenshots, reports, logs, analytics, or a developer backend.",
    error:
      "Privacy policy is missing the ElevenLabs key exclusion boundaries.",
  },
  {
    key: "privacy",
    statement:
      "A rejected API key stops that provider's scheduled requests while stale normalized usage and history remain until replacement or deletion.",
    error:
      "Privacy policy is missing the rejected ElevenLabs key behavior.",
  },
  {
    key: "privacy",
    statement:
      "Disconnect, Delete all local data, uninstall, or clearing extension storage deletes the saved API key.",
    error:
      "Privacy policy is missing the complete ElevenLabs key-deletion lifecycle.",
  },
  {
    key: "privacy",
    statement:
      "If Chrome cannot revoke a final-owner host permission, local instance deletion remains authoritative and durable cleanup evidence is retained for retry.",
    error:
      "Privacy policy is missing the permission-cleanup failure boundary.",
  },
  {
    key: "faqZh",
    statement:
      "保存的密钥只会作为 xi-api-key 请求头发送到 https://api.elevenlabs.io，用于只读订阅请求。",
    error:
      "Simplified Chinese FAQ is missing the exact ElevenLabs key destination disclosure.",
  },
  {
    key: "faqZh",
    statement:
      "AI Limits 会将密钥单独保存在 chrome.storage.local，并通过 Chrome 存储访问级别限制为仅受信任的扩展上下文可读。",
    error:
      "Simplified Chinese FAQ is missing the trusted-context key-storage disclosure.",
  },
  {
    key: "faqZh",
    statement:
      "该密钥不受操作系统钥匙串加密保护；能够访问未锁定 Chrome 配置文件、扩展 DevTools 或本地配置文件的人仍可能检查到它。",
    error:
      "Simplified Chinese FAQ is missing the local API-key inspection limitation.",
  },
  {
    key: "faqZh",
    statement:
      "该密钥绝不会写入用量状态、History、截图、报告、日志、分析系统或开发者后端。",
    error:
      "Simplified Chinese FAQ is missing the ElevenLabs key exclusion boundaries.",
  },
  {
    key: "faqZh",
    statement:
      "如果保存的 ElevenLabs 密钥被拒绝，AI Limits 会停止定时 ElevenLabs 请求，并保留过期的标准化用量和 History，直到替换或删除密钥。",
    error:
      "Simplified Chinese FAQ is missing the rejected ElevenLabs key behavior.",
  },
  {
    key: "faqZh",
    statement:
      "断开 ElevenLabs、选择 Delete all local data、卸载扩展或清除扩展存储，都会删除保存的密钥。",
    error:
      "Simplified Chinese FAQ is missing the complete ElevenLabs key-deletion lifecycle.",
  },
  {
    key: "faqZh",
    statement:
      "如果 Chrome 无法撤销最后一个所有者的主机权限，本地实例删除仍然有效，并会保留持久清理证据供之后重试。",
    error:
      "Simplified Chinese FAQ is missing the permission-cleanup failure boundary.",
  },
  {
    key: "listing",
    statement:
      "Authentication information: Yes. This includes provider API keys that the user creates and AI Limits saves locally after successful validation.",
    error:
      "Store listing is missing the saved provider-key authentication disclosure.",
  },
  {
    key: "listing",
    statement:
      "confirm First Run opens with twenty opt-in provider rows and no prefilled usage.",
    error:
      "Store listing reviewer flow must expect twenty First Run provider rows.",
  },
];
const v030PublicationStatements = [
  {
    key: "faq",
    statement:
      "Both. A successful Connect, provider Refresh, header refresh button, or scheduled automatic refresh adds one normalized typed History observation containing the quota, counter or spend, and balance metrics returned by that provider. History graphs quota metrics only; counter or spend and balance observations remain stored but are not graphed.",
    error:
      "English FAQ introduction is missing typed History and quota-only graph behavior.",
  },
  {
    key: "faqZh",
    statement:
      "两者都会。成功的 Connect、单个服务 Refresh、顶部刷新按钮或定时自动刷新，都会新增一条标准化类型化 History 观测，其中包含该服务本次返回的配额、计数或支出以及余额指标。History 只绘制配额指标；计数或支出和余额观测仍会保存，但不会绘图。",
    error:
      "Simplified Chinese FAQ introduction is missing typed History and quota-only graph behavior.",
  },
  {
    key: "readme",
    statement:
      "AI Limits supports multiple New API instances. Each instance keeps its own normalized base URL, label, relay key, current usage, refresh state, and History.",
    error: "README is missing the rendered multi-instance New API disclosure.",
  },
  {
    key: "readmeZh",
    statement:
      "AI Limits 支持多个 New API 实例。每个实例分别保存自己的标准化基础网址、标签、Relay Key、当前用量、刷新状态和 History。",
    error:
      "Simplified Chinese README is missing the rendered multi-instance New API disclosure.",
  },
  {
    key: "faq",
    statement:
      "Two New API instances on the same origin share only Chrome's browser-global origin permission; they never share a relay key, label, usage state, or History.",
    error: "English FAQ is missing the same-origin New API isolation disclosure.",
  },
  {
    key: "faqZh",
    statement:
      "位于同一来源的两个 New API 实例只会共享 Chrome 的浏览器全局来源权限；它们绝不会共享 Relay Key、标签、用量状态或 History。",
    error:
      "Simplified Chinese FAQ is missing the same-origin New API isolation disclosure.",
  },
  {
    key: "faq",
    statement:
      "Kimi scheduled refresh never opens a tab. An interactive Connect or Refresh may open at most one inactive temporary Kimi tab, waits up to 10 seconds for recovery, and closes only the tab it created.",
    error: "English FAQ is missing the exact bounded Kimi tab policy.",
  },
  {
    key: "faqZh",
    statement:
      "Kimi 定时刷新绝不会打开标签页。交互式 Connect 或 Refresh 最多打开一个非活动的临时 Kimi 标签页，最多等待 10 秒完成恢复，并且只关闭它自己创建的标签页。",
    error: "Simplified Chinese FAQ is missing the exact bounded Kimi tab policy.",
  },
  {
    key: "supported",
    statement:
      "New API supports multiple independent instances. Each configured instance has its own normalized base URL, label, relay key, usage, History, refresh state, replacement, rejection, and deletion lifecycle.",
    error: "Supported providers is missing the New API instance lifecycle.",
  },
  {
    key: "supported",
    statement:
      "Same-origin instances share only Chrome's browser-global origin grant; credentials, labels, usage state, and History remain independent.",
    error: "Supported providers is missing the shared-origin boundary.",
  },
  {
    key: "supportedZh",
    statement:
      "New API 支持多个相互独立的实例。每个已配置实例分别拥有自己的标准化基础网址、标签、Relay Key、用量、History、刷新状态、替换、拒绝和删除生命周期。",
    error:
      "Simplified Chinese supported providers is missing the New API instance lifecycle.",
  },
  {
    key: "supportedZh",
    statement:
      "同一来源的实例只共享 Chrome 的浏览器全局来源授权；凭据、标签、用量状态和 History 始终相互独立。",
    error:
      "Simplified Chinese supported providers is missing the shared-origin boundary.",
  },
  {
    key: "privacy",
    statement:
      "Successful normalized quota, counter or spend, and balance observations are stored per instance for up to 30 days, subject to a 1,024-observation per-instance safety cap.",
    error: "Privacy policy is missing the typed per-instance history disclosure.",
  },
  {
    key: "privacy",
    statement:
      "Within that cap, the newest 48 hours remain at collection resolution and older retained observations are compacted to the latest observation in each UTC hour.",
    error: "Privacy policy is missing the exact history compaction policy.",
  },
  {
    key: "privacy",
    statement:
      "History graphs plot quota metrics only; counter or spend and balance observations remain stored but are not graphed.",
    error: "Privacy policy is missing the quota-only graph disclosure.",
  },
  {
    key: "privacy",
    statement: "History never stores credentials or raw provider responses.",
    error: "Privacy policy is missing the credential and raw-response exclusion.",
  },
  {
    key: "privacy",
    statement:
      "Currency-denominated spend counters and balances are normalized usage data, not raw payment transaction history.",
    error: "Privacy policy is missing the normalized financial-data distinction.",
  },
  {
    key: "privacy",
    statement:
      "Externally removing a permission marks every affected instance permission-required while retaining its nonsecret configuration, normalized usage, refresh status, and History.",
    error: "Privacy policy is missing the external-permission retention behavior.",
  },
  {
    key: "privacy",
    statement:
      "Disconnect deletes that instance's credential, configuration, usage, refresh status, and History before permission cleanup; a shared origin remains granted while another active instance owns it, and final-owner removal is best-effort with durable retry evidence.",
    error: "Privacy policy is missing the instance disconnect and final-owner behavior.",
  },
  {
    key: "listing",
    statement:
      "Successful normalized quota, counter or spend, and balance observations are retained per instance; History graphs quota metrics, while counter or spend and balance observations remain stored but ungraphed.",
    error: "Store listing is missing typed history and quota-only graph behavior.",
  },
];
const listingLinks = [
  {
    markdown: "[Artwork instructions](../README.md)",
    error:
      "Store listing is missing the listing-relative artwork instructions link: ../README.md.",
  },
  {
    markdown: "[Privacy policy](../../PRIVACY.md)",
    error:
      "Store listing is missing the listing-relative privacy link: ../../PRIVACY.md.",
  },
];
const listingDefaults = [
  {
    value: "Category: Productivity",
    error: "Store listing is missing required default: Category: Productivity.",
  },
  {
    value: "Primary language: English",
    error: "Store listing is missing required default: Primary language: English.",
  },
  {
    value: "Mature content: No",
    error: "Store listing is missing required default: Mature content: No.",
  },
  {
    value: "Distribution: Public, all regions",
    error: "Store listing is missing required default: Distribution: Public, all regions.",
  },
  {
    value: "Pricing: Free",
    error: "Store listing is missing required default: Pricing: Free.",
  },
  {
    value: "Homepage: https://github.com/TiantianFlow/ai-limits",
    error:
      "Store listing is missing required default: Homepage: https://github.com/TiantianFlow/ai-limits.",
  },
  {
    value:
      "Privacy policy: https://github.com/TiantianFlow/ai-limits/blob/main/PRIVACY.md",
    error:
      "Store listing is missing required default: Privacy policy: https://github.com/TiantianFlow/ai-limits/blob/main/PRIVACY.md.",
  },
  {
    value: "Support: https://github.com/TiantianFlow/ai-limits/issues",
    error:
      "Store listing is missing required default: Support: https://github.com/TiantianFlow/ai-limits/issues.",
  },
  {
    value: "Remote hosted code: No",
    error: "Store listing is missing required default: Remote hosted code: No.",
  },
];

const valid = {
  readme: `${issuesLink}\n${faqLink}\n${storeLink}\n${releaseLink}\n${releaseChannelStatement}\n${elevenLabsPublicationStatements[0].statement}\n${v030PublicationStatements.filter(({ key }) => key === "readme").map(({ statement }) => statement).join("\n")}`,
  readmeZh: `[常见问题](FAQ.zh-CN.md)\n${storeLink}\n${releaseLink}\n${releaseChannelStatementZh}\n${elevenLabsPublicationStatements[1].statement}\n${v030PublicationStatements.filter(({ key }) => key === "readmeZh").map(({ statement }) => statement).join("\n")}`,
  faq: `English | [简体中文](FAQ.zh-CN.md)\n${kimiAutoRefreshStatement}\n${elevenLabsPublicationStatements[2].statement}\n${v030PublicationStatements.filter(({ key }) => key === "faq").map(({ statement }) => statement).join("\n")}`,
  faqZh: [
    "[English](FAQ.md) | 简体中文",
    kimiAutoRefreshStatementZh,
    ...elevenLabsPublicationStatements
      .filter(({ key }) => key === "faqZh")
      .map(({ statement }) => statement),
    ...v030PublicationStatements
      .filter(({ key }) => key === "faqZh")
      .map(({ statement }) => statement),
  ].join("\n"),
  supported: v030PublicationStatements
    .filter(({ key }) => key === "supported")
    .map(({ statement }) => statement)
    .join("\n"),
  supportedZh: v030PublicationStatements
    .filter(({ key }) => key === "supportedZh")
    .map(({ statement }) => statement)
    .join("\n"),
  privacy: [
    issuesLink,
    "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.",
    ...elevenLabsPublicationStatements
      .filter(({ key }) => key === "privacy")
      .map(({ statement }) => statement),
    ...v030PublicationStatements
      .filter(({ key }) => key === "privacy")
      .map(({ statement }) => statement),
  ].join("\n"),
  security: [
    issuesLink,
    securityCondition,
    securityFallback,
    credentialBoundaryStatement,
  ].join("\n"),
  listing: [
    ...listingDefaults.map(({ value }) => value),
    ...listingLinks.map(({ markdown }) => markdown),
    paceAvailabilityStatement,
    storeShortDescription,
    publicRouteGate,
    ...elevenLabsPublicationStatements
      .filter(({ key }) => key === "listing")
      .map(({ statement }) => statement),
    ...v030PublicationStatements
      .filter(({ key }) => key === "listing")
      .map(({ statement }) => statement),
    "## Detailed description",
    supportedProvidersUrl,
    "## Permission justifications",
  ].join("\n"),
  listingZh: [
    "## 详细说明",
    supportedProvidersUrlZh,
    "## 权限说明",
  ].join("\n"),
  license: "MIT License\n\nCopyright (c) 2026 TiantianFlow",
};

const faqNavigationLinks = [
  {
    key: "readme",
    markdown: "[FAQ](FAQ.md)",
    error: "README is missing the root-relative FAQ link: FAQ.md.",
  },
  {
    key: "readmeZh",
    markdown: "[常见问题](FAQ.zh-CN.md)",
    error:
      "Simplified Chinese README is missing the root-relative FAQ link: FAQ.zh-CN.md.",
  },
  {
    key: "faq",
    markdown: "[简体中文](FAQ.zh-CN.md)",
    error:
      "English FAQ is missing the Simplified Chinese FAQ link: FAQ.zh-CN.md.",
  },
  {
    key: "faqZh",
    markdown: "[English](FAQ.md)",
    error: "Simplified Chinese FAQ is missing the English FAQ link: FAQ.md.",
  },
];

const kimiFaqStatements = [
  {
    key: "faq",
    statement: kimiAutoRefreshStatement,
    error:
      "English FAQ is missing the rendered Kimi automatic-refresh limitation.",
  },
  {
    key: "faqZh",
    statement: kimiAutoRefreshStatementZh,
    error:
      "Simplified Chinese FAQ is missing the rendered Kimi automatic-refresh limitation.",
  },
];

const policyDocuments = [
  {
    key: "readme",
    label: "README",
    error: "README is missing the canonical GitHub Issues Markdown link.",
  },
  {
    key: "privacy",
    label: "Privacy policy",
    error: "Privacy policy is missing the canonical GitHub Issues Markdown link.",
  },
  {
    key: "security",
    label: "Security policy",
    error: "Security policy is missing the canonical GitHub Issues Markdown link.",
  },
];

const nonRenderedIssuesLinks = [
  {
    context: "an HTML comment",
    document: `<!-- ${issuesLink} -->`,
  },
  {
    context: "an unclosed HTML comment",
    document: `<!-- ${issuesLink}`,
  },
  {
    context: "a same-line unclosed HTML comment after ordinary text",
    document: `ordinary text <!-- ${issuesLink}`,
  },
  {
    context: "a same-line closed HTML comment after ordinary text",
    document: `ordinary text <!-- ${issuesLink} -->`,
  },
  {
    context: "a multiline HTML comment after ordinary text",
    document: ["ordinary text <!--", issuesLink, "-->"].join("\n"),
  },
  {
    context: "an inline code span",
    document: `\`${issuesLink}\``,
  },
  {
    context: "a fenced code block",
    document: ["```markdown", issuesLink, "```"].join("\n"),
  },
  {
    context: "escaped Markdown syntax",
    document: `\\${issuesLink}`,
  },
  {
    context: "4-space indented code",
    document: `    ${issuesLink}`,
  },
  {
    context: "a raw HTML block",
    document: ["<div>", issuesLink, "</div>"].join("\n"),
  },
  {
    context: "a raw HTML attribute",
    document: `<div data-support="${issuesLink}"></div>`,
  },
  {
    context: "a raw script block",
    document: ["<script>", `const support = "${issuesLink}";`, "</script>"].join(
      "\n",
    ),
  },
];

const nonRenderedHistoryDisclosures = [
  {
    context: "an HTML comment",
    replacement: `<!-- ${historyRetentionStatement} -->`,
  },
  {
    context: "a fenced code block",
    replacement: ["```text", historyRetentionStatement, "```"].join("\n"),
  },
  {
    context: "an inline code span",
    replacement: `\`${historyRetentionStatement}\``,
  },
];

describe("publication content", () => {
  it.each([
    { key: "readme", statement: releaseChannelStatement },
    { key: "readmeZh", statement: releaseChannelStatementZh },
  ])("requires truthful release-channel guidance in $key", ({ key, statement }) => {
    expect(
      validatePublicationDocuments({
        ...valid,
        [key]: valid[key].replace(statement, ""),
      }),
    ).toContain(
      key === "readme"
        ? "README is missing the Chrome Web Store release-lag guidance."
        : "Simplified Chinese README is missing the Chrome Web Store release-lag guidance.",
    );
  });

  it.each(["readme", "readmeZh"])(
    "requires the canonical Store and GitHub release links in %s",
    (key) => {
      expect(
        validatePublicationDocuments({
          ...valid,
          [key]: valid[key].replace(storeLink, "Chrome Web Store"),
        }),
      ).toContain(
        key === "readme"
          ? "README is missing the canonical Chrome Web Store Markdown link."
          : "Simplified Chinese README is missing the canonical Chrome Web Store Markdown link.",
      );
      expect(
        validatePublicationDocuments({
          ...valid,
          [key]: valid[key].replace(releaseLink, "GitHub release"),
        }),
      ).toContain(
        key === "readme"
          ? "README is missing the canonical GitHub release Markdown link."
          : "Simplified Chinese README is missing the canonical GitHub release Markdown link.",
      );
    },
  );

  it("requires the practical background-response and rendered-UI credential boundary", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      security: valid.security.replace(credentialBoundaryStatement, ""),
    });
    expect(errors).toContain(
      "Security policy is missing the practical side-panel credential boundary.",
    );
  });

  it("rejects the inaccurate claim that the key can never reach the side-panel context", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      security: `${valid.security}\nThe key is never returned to the side panel.`,
    });
    expect(errors).toContain(
      "Security policy overstates isolation from the trusted side-panel context.",
    );
  });

  it("requires the exact manifest-matched short description as visible listing prose", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      listing: valid.listing.replace(storeShortDescription, ""),
    });
    expect(errors).toContain(
      "Store listing short description must exactly match the manifest description.",
    );
  });

  it("requires direct compatibility links and rejects provider inventories in Store descriptions", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        listing: valid.listing.replace(supportedProvidersUrl, ""),
      }),
    ).toContain(
      "English Store detailed description is missing the direct supported-providers URL.",
    );
    expect(
      validatePublicationDocuments({
        ...valid,
        listingZh: valid.listingZh.replace(supportedProvidersUrlZh, ""),
      }),
    ).toContain(
      "Simplified Chinese Store detailed description is missing the direct supported-providers URL.",
    );
    expect(
      validatePublicationDocuments({
        ...valid,
        listing: valid.listing.replace(
          supportedProvidersUrl,
          `${supportedProvidersUrl}\nChatGPT`,
        ),
      }),
    ).toContain(
      "English Store detailed description must not enumerate provider brands.",
    );
  });

  it.each(elevenLabsPublicationStatements)(
    "requires visible ElevenLabs disclosure in $key: $error",
    ({ key, statement, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        [key]: valid[key].replace(statement, ""),
      });
      expect(errors).toContain(error);
    },
  );

  it.each([
    {
      context: "an HTML comment",
      wrap: (statement) => `<!-- ${statement} -->`,
    },
    {
      context: "a fenced code block",
      wrap: (statement) => ["```text", statement, "```"].join("\n"),
    },
    {
      context: "inline code",
      wrap: (statement) => `\`${statement}\``,
    },
    {
      context: "a plain raw HTML wrapper",
      wrap: (statement) => `<span>${statement}</span>`,
    },
    {
      context: "an opacity-zero raw HTML wrapper",
      wrap: (statement) =>
        `<span style="opacity: 0">${statement}</span>`,
    },
    {
      context: "nested visible raw HTML wrappers",
      wrap: (statement) => `<section><span>${statement}</span></section>`,
    },
    {
      context: "a raw HTML block containing Markdown-shaped prose",
      wrap: (statement) =>
        [
          "<div>",
          "",
          `**${statement}** [reference](https://example.com)`,
          "",
          "</div>",
        ].join("\n"),
    },
    {
      context: "an unclosed raw HTML wrapper",
      wrap: (statement) => `<span>${statement}`,
    },
    {
      context: "slash-ended non-void inline HTML",
      wrap: (statement) => `<span hidden/>${statement}`,
    },
    {
      context: "slash-ended non-void block HTML",
      wrap: (statement) => ["<div hidden/>", "", statement].join("\n"),
    },
    {
      context: "a slash-ended custom element",
      wrap: (statement) => `<x-secret hidden/>${statement}`,
    },
    {
      context: "a same-line hidden raw HTML wrapper",
      wrap: (statement) => `<span hidden>${statement}</span>`,
    },
    {
      context: "a multiline hidden raw HTML block",
      wrap: (statement) =>
        ["<div hidden>", "", statement, "", "</div>"].join("\n"),
    },
    {
      context: "nested raw HTML with a hidden inner wrapper",
      wrap: (statement) =>
        `<section><span hidden>${statement}</span></section>`,
    },
    {
      context: "a closed details disclosure",
      wrap: (statement) =>
        ["<details>", "<summary>More</summary>", "", statement, "", "</details>"].join("\n"),
    },
  ])(
    "rejects the ElevenLabs key-storage disclosure when it appears only in $context",
    ({ wrap }) => {
      const requirement = elevenLabsPublicationStatements.find(
        ({ error }) => error.includes("trusted-context"),
      );
      const errors = validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          requirement.statement,
          wrap(requirement.statement),
        ),
      });
      expect(errors).toContain(requirement.error);
    },
  );

  it("accepts the ElevenLabs key-storage disclosure as ordinary visible Markdown", () => {
    const requirement = elevenLabsPublicationStatements.find(
      ({ error }) => error.includes("trusted-context ElevenLabs"),
    );
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          requirement.statement,
          `**${requirement.statement}**`,
        ),
      }),
    ).toEqual([]);
  });

  it("keeps ordinary visible Markdown adjacent to raw HTML eligible", () => {
    const requirement = elevenLabsPublicationStatements.find(
      ({ error }) => error.includes("trusted-context ElevenLabs"),
    );
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          requirement.statement,
          `<span>Decorative source HTML</span> ${requirement.statement}`,
        ),
      }),
    ).toEqual([]);
  });

  it.each([
    ["br", (statement) => `<br/>${statement}`],
    ["img", (statement) => `<img alt="Decorative"/> ${statement}`],
  ])("keeps ordinary Markdown after the void %s element eligible", (_tag, wrap) => {
    const requirement = elevenLabsPublicationStatements.find(
      ({ error }) => error.includes("trusted-context ElevenLabs"),
    );
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          requirement.statement,
          wrap(requirement.statement),
        ),
      }),
    ).toEqual([]);
  });

  it("requires the store listing to describe the actual pace inputs", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      listing: valid.listing.replace(paceAvailabilityStatement, ""),
    });
    expect(errors).toContain(
      "Store listing is missing the reset-time-or-duration pace qualification.",
    );
  });

  it.each(kimiFaqStatements)(
    "requires the rendered Kimi automatic-refresh limitation in $key",
    ({ key, statement, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        [key]: valid[key].replace(statement, ""),
      });
      expect(errors).toContain(error);
    },
  );

  it.each(v030PublicationStatements)(
    "requires the rendered History graph disclosure in $key: $error",
    ({ key, statement, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        [key]: valid[key].replace(statement, ""),
      });
      expect(errors).toContain(error);
    },
  );

  it.each(faqNavigationLinks)(
    "rejects a missing FAQ navigation link from $key",
    ({ key, markdown, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        [key]: valid[key].replace(markdown, ""),
      });
      expect(errors).toContain(error);
    },
  );

  it("rejects pre-publication placeholders", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      readme: "This project is still in pre-publication acceptance.",
    });
    expect(errors).toContain("README still contains pre-publication placeholder copy.");
  });

  it("requires an affirmative Limited Use statement", () => {
    const errors = validatePublicationDocuments({ ...valid, privacy: "Privacy policy" });
    expect(errors).toContain("Privacy policy is missing the Limited Use compliance statement.");
  });

  it("requires the privacy policy to disclose typed per-instance history retention", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      privacy: valid.privacy.replace(historyRetentionStatement, ""),
    });
    expect(errors).toContain(
      "Privacy policy is missing the typed per-instance history disclosure.",
    );
  });

  it("requires typed history to disclose the per-instance safety cap", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          historyRetentionStatement,
          uncappedHistoryRetentionStatement,
        ),
      }),
    ).toContain(
      "Privacy policy is missing the typed per-instance history disclosure.",
    );
  });

  it.each(nonRenderedHistoryDisclosures)(
    "rejects the quota-history disclosure when it appears only in $context",
    ({ replacement }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(historyRetentionStatement, replacement),
      });
      expect(errors).toContain(
        "Privacy policy is missing the typed per-instance history disclosure.",
      );
    },
  );

  it("accepts the quota-history disclosure when ordinary prose wraps across lines", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          historyRetentionStatement,
          "Successful normalized quota, counter or spend, and balance observations are stored per instance for up to 30 days,\nsubject to a 1,024-observation per-instance safety cap.",
        ),
      }),
    ).toEqual([]);
  });

  it.each(policyDocuments)(
    "requires a contextual Issues link in $label when the URL is only bare text",
    ({ key, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        [key]: valid[key].replace(issuesLink, issuesUrl),
      });
      expect(errors).toContain(error);
    },
  );

  it.each(policyDocuments)(
    "rejects a wrong Issues link target in $label even when the canonical URL appears elsewhere",
    ({ key, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        [key]: `${valid[key].replace(
          issuesLink,
          "[GitHub Issues](https://example.com/issues)",
        )}\n${issuesUrl}`,
      });
      expect(errors).toContain(error);
    },
  );

  it.each(nonRenderedIssuesLinks)(
    "rejects an Issues link present only in $context",
    ({ document }) => {
      const errors = validatePublicationDocuments({ ...valid, readme: document });
      expect(errors).toContain(
        "README is missing the canonical GitHub Issues Markdown link.",
      );
    },
  );

  it("accepts a real canonical Issues link with a different label", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        readme: valid.readme.replace(
          issuesLink,
          `[Report a problem](${issuesUrl})`,
        ),
      }),
    ).toEqual([]);
  });

  it("accepts a real canonical Issues link with a nested label and title", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        readme: valid.readme.replace(
          issuesLink,
          `[Report [a bug]](<${issuesUrl}> "Issue tracker")`,
        ),
      }),
    ).toEqual([]);
  });

  it.each([
    {
      context: "inline code",
      document: `\`literal <!--\` ${issuesLink}`,
    },
    {
      context: "a fenced code block",
      document: ["```text", "literal <!--", "```", issuesLink].join("\n"),
    },
  ])(
    "accepts a real Issues link after literal unclosed comment syntax in $context",
    ({ document }) => {
      expect(
        validatePublicationDocuments({
          ...valid,
          readme: valid.readme.replace(issuesLink, document),
        }),
      ).toEqual([]);
    },
  );

  it.each(listingDefaults)("rejects an omitted $value listing default", ({ value, error }) => {
    const errors = validatePublicationDocuments({
      ...valid,
      listing: valid.listing.replace(value, ""),
    });
    expect(errors).toContain(error);
  });

  it.each(listingLinks)(
    "rejects a missing listing-relative listing link from $markdown",
    ({ markdown, error }) => {
      const errors = validatePublicationDocuments({
        ...valid,
        listing: valid.listing.replace(markdown, ""),
      });
      expect(errors).toContain(error);
    },
  );

  it("requires private vulnerability reporting to be conditional", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      security: valid.security.replace(
        securityCondition,
        "Use GitHub private vulnerability reporting for sensitive reports.",
      ),
    });
    expect(errors).toContain(
      "Security policy must make private vulnerability reporting conditional on Security-tab availability.",
    );
  });

  it("requires a non-disclosing fallback when private reporting is unavailable", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      security: valid.security.replace(securityFallback, ""),
    });
    expect(errors).toContain(
      "Security policy is missing the non-disclosing private-contact fallback.",
    );
  });

  it("defers public-route verification until after repository visibility is public", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      listing: valid.listing.replace(
        publicRouteGate,
        "GitHub Issues is enabled and reachable at https://github.com/TiantianFlow/ai-limits/issues.",
      ),
    });
    expect(errors).toContain(
      "Store listing must defer public-route verification until after repository visibility is public.",
    );
  });

  it("requires the license notice", () => {
    const errors = validatePublicationDocuments({ ...valid, license: "MIT License" });
    expect(errors).toContain("LICENSE is missing the 2026 TiantianFlow copyright notice.");
  });

  it.each([
    "readme",
    "readmeZh",
    "faq",
    "faqZh",
    "supported",
    "supportedZh",
    "privacy",
    "security",
    "listing",
    "license",
  ])("rejects a noncanonical repository owner in $key", (key) => {
    const errors = validatePublicationDocuments({
      ...valid,
      [key]: `${valid[key]}\nhttps://github.com/retired-owner/ai-limits`,
    });
    expect(errors).toContain(
      "Publication documents must use the canonical TiantianFlow repository URL.",
    );
  });

  it("accepts required guidance wrapped across Markdown lines", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        security: valid.security.replace(
          "private vulnerability reporting is available",
          "private vulnerability reporting is\navailable",
        ),
        listing: valid.listing.replace(
          "Chrome Web Store submission, verify",
          "Chrome Web Store submission,\nverify",
        ),
      }),
    ).toEqual([]);
  });

  it("accepts the final public-facing contract", () => {
    expect(validatePublicationDocuments(valid)).toEqual([]);
  });
});
