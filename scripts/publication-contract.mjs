import MarkdownIt from "markdown-it";

import { EXPECTED_DESCRIPTION } from "./artifact-contract.mjs";

const issuesUrl = "https://github.com/TiantianFlow/ai-limits/issues";
const storeUrl =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";
const releaseUrl = "https://github.com/TiantianFlow/ai-limits/releases/latest";
const canonicalRepositoryOwner = "TiantianFlow";
const repositoryOwnerPatterns = [
  /https:\/\/github\.com\/([^/\s)]+)\/ai-limits\b/gi,
  /https:\/\/img\.shields\.io\/github\/(?:license|v\/release)\/([^/\s)]+)\/ai-limits\b/gi,
];
const releaseChannelStatement =
  "Chrome Web Store releases can lag while review or publishing is pending; the Store badge shows the currently published version.";
const releaseChannelStatementZh =
  "Chrome 应用商店版本可能因审核或发布流程而滞后；应用商店徽章显示当前已发布的版本。";
const limitedUseStatement =
  "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.";
const historyRetentionStatement =
  "Successful normalized quota, counter or spend, and balance observations are stored per instance for up to 30 days, subject to a 1,024-observation per-instance safety cap.";
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
const requiredVisibleFaqStatements = [
  {
    key: "faq",
    statement:
      "Kimi automatic refresh is best-effort and may not always work; a manual Connect or Refresh may briefly open an inactive Kimi tab in the background to recover the session.",
    error:
      "English FAQ is missing the rendered Kimi automatic-refresh limitation.",
  },
  {
    key: "faqZh",
    statement:
      "Kimi 自动刷新属于尽力而为，并不保证每次都能成功；手动 Connect 或 Refresh 可能会在后台短暂打开一个非活动 Kimi 标签页以恢复会话。",
    error:
      "Simplified Chinese FAQ is missing the rendered Kimi automatic-refresh limitation.",
  },
];
const requiredVisibleElevenLabsStatements = [
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
      "confirm the side panel opens with twenty permission-required cards.",
    error:
      "Store listing reviewer flow must expect twenty permission-required cards.",
  },
];
const requiredVisibleV030Statements = [
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
      "AI Limits supports multiple independent New API instances, including multiple separately labeled keys on the same origin.",
    error: "Store listing is missing multi-instance New API support.",
  },
  {
    key: "listing",
    statement:
      "Successful normalized quota, counter or spend, and balance observations are retained per instance; History graphs quota metrics, while counter or spend and balance observations remain stored but ungraphed.",
    error: "Store listing is missing typed history and quota-only graph behavior.",
  },
];

const requiredListingDefaults = [
  "Category: Productivity",
  "Primary language: English",
  "Mature content: No",
  "Distribution: Public, all regions",
  "Pricing: Free",
  "Homepage: https://github.com/TiantianFlow/ai-limits",
  "Privacy policy: https://github.com/TiantianFlow/ai-limits/blob/main/PRIVACY.md",
  `Support: ${issuesUrl}`,
  "Remote hosted code: No",
];
const requiredListingLinks = [
  {
    destination: "../README.md",
    error:
      "Store listing is missing the listing-relative artwork instructions link: ../README.md.",
  },
  {
    destination: "../../PRIVACY.md",
    error:
      "Store listing is missing the listing-relative privacy link: ../../PRIVACY.md.",
  },
];
const requiredFaqNavigationLinks = [
  {
    key: "readme",
    destination: "FAQ.md",
    error: "README is missing the root-relative FAQ link: FAQ.md.",
  },
  {
    key: "readmeZh",
    destination: "FAQ.zh-CN.md",
    error:
      "Simplified Chinese README is missing the root-relative FAQ link: FAQ.zh-CN.md.",
  },
  {
    key: "faq",
    destination: "FAQ.zh-CN.md",
    error:
      "English FAQ is missing the Simplified Chinese FAQ link: FAQ.zh-CN.md.",
  },
  {
    key: "faqZh",
    destination: "FAQ.md",
    error: "Simplified Chinese FAQ is missing the English FAQ link: FAQ.md.",
  },
];
const markdown = new MarkdownIt({ html: true, linkify: false });
const voidHtmlElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function normalizeWhitespace(document) {
  return (document ?? "").replace(/\s+/g, " ");
}

function updateHtmlCommentState(content, commentOpen) {
  let cursor = 0;

  while (cursor < content.length) {
    if (commentOpen) {
      const commentEnd = content.indexOf("-->", cursor);
      if (commentEnd === -1) {
        return true;
      }
      commentOpen = false;
      cursor = commentEnd + 3;
      continue;
    }

    const commentStart = content.indexOf("<!--", cursor);
    if (commentStart === -1) {
      return false;
    }
    commentOpen = true;
    cursor = commentStart + 4;
  }

  return commentOpen;
}

function extractInlineMarkdownLinkDestinations(document) {
  const destinations = [];
  let commentOpen = false;

  for (const blockToken of markdown.parse(document ?? "", {})) {
    if (blockToken.type === "html_block") {
      commentOpen = updateHtmlCommentState(blockToken.content, commentOpen);
      continue;
    }

    if (blockToken.type !== "inline") {
      continue;
    }

    for (const token of blockToken.children ?? []) {
      if (token.type === "html_inline" || token.type === "text") {
        commentOpen = updateHtmlCommentState(token.content, commentOpen);
        continue;
      }

      if (token.type === "link_open" && !commentOpen) {
        destinations.push(token.attrGet("href"));
      }
    }
  }

  return destinations;
}

function isHtmlTagNameCharacter(character) {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === "-" ||
    character === ":" ||
    character === "_"
  );
}

function findRawHtmlTagEnd(source, start) {
  let quote;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }

  return -1;
}

function updateRawHtmlElementStack(source, elementStack) {
  let cursor = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) return;

    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) return;
      cursor = commentEnd + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = source.indexOf("]]>", tagStart + 9);
      if (cdataEnd === -1) return;
      cursor = cdataEnd + 3;
      continue;
    }

    let nameStart = tagStart + 1;
    let closing = false;
    if (source[nameStart] === "/") {
      closing = true;
      nameStart += 1;
    }

    if (!isHtmlTagNameCharacter(source[nameStart])) {
      const declarationEnd = findRawHtmlTagEnd(source, nameStart);
      if (declarationEnd === -1) return;
      cursor = declarationEnd + 1;
      continue;
    }

    let nameEnd = nameStart + 1;
    while (isHtmlTagNameCharacter(source[nameEnd])) nameEnd += 1;

    const tagEnd = findRawHtmlTagEnd(source, nameEnd);
    if (tagEnd === -1) return;

    const tagName = source.slice(nameStart, nameEnd).toLowerCase();
    if (closing) {
      const matchingIndex = elementStack.lastIndexOf(tagName);
      if (matchingIndex !== -1) elementStack.splice(matchingIndex);
    } else if (!voidHtmlElements.has(tagName)) {
      // In HTML, a trailing slash does not self-close non-void or custom
      // elements, so every non-void start tag keeps suppressing nested prose.
      elementStack.push(tagName);
    }

    cursor = tagEnd + 1;
  }
}

function extractQualifyingMarkdownProse(document) {
  // Publication disclosures must be ordinary Markdown prose. markdown-it gives
  // us source-authored HTML boundaries; tracking those elements keeps all of
  // their contents ineligible without trying to emulate browser CSS.
  const visible = [];
  const rawHtmlElementStack = [];

  for (const blockToken of markdown.parse(document ?? "", {})) {
    if (blockToken.type === "html_block") {
      updateRawHtmlElementStack(blockToken.content, rawHtmlElementStack);
      continue;
    }

    if (blockToken.type !== "inline") continue;

    for (const token of blockToken.children ?? []) {
      if (token.type === "html_inline") {
        updateRawHtmlElementStack(token.content, rawHtmlElementStack);
      } else if (token.type === "text" && rawHtmlElementStack.length === 0) {
        visible.push(token.content);
      } else if (
        (token.type === "softbreak" || token.type === "hardbreak") &&
        rawHtmlElementStack.length === 0
      ) {
        visible.push(" ");
      }
    }

    if (rawHtmlElementStack.length === 0) visible.push(" ");
  }

  return normalizeWhitespace(visible.join(" "));
}

export function validatePublicationDocuments(documents) {
  const errors = [];
  if (Object.values(documents).some((source) => {
    const content = String(source ?? "");
    return repositoryOwnerPatterns.some((pattern) =>
      [...content.matchAll(pattern)].some(
        (match) => match[1] !== canonicalRepositoryOwner,
      ),
    );
  })) {
    errors.push(
      "Publication documents must use the canonical TiantianFlow repository URL.",
    );
  }
  const policies = [
    ["README", "readme"],
    ["Privacy policy", "privacy"],
    ["Security policy", "security"],
  ];

  for (const [label, key] of policies) {
    const source = documents[key] ?? "";
    const document = normalizeWhitespace(source);
    if (document.includes("pre-publication acceptance")) {
      errors.push(`${label} still contains pre-publication placeholder copy.`);
    }
    if (!extractInlineMarkdownLinkDestinations(source).includes(issuesUrl)) {
      errors.push(`${label} is missing the canonical GitHub Issues Markdown link.`);
    }
  }

  for (const { key, destination, error } of requiredFaqNavigationLinks) {
    if (
      !extractInlineMarkdownLinkDestinations(documents[key] ?? "").includes(
        destination,
      )
    ) {
      errors.push(error);
    }
  }

  for (const { key, statement, error } of requiredVisibleFaqStatements) {
    if (!extractQualifyingMarkdownProse(documents[key] ?? "").includes(statement)) {
      errors.push(error);
    }
  }

  for (const { key, statement, error } of requiredVisibleElevenLabsStatements) {
    if (!extractQualifyingMarkdownProse(documents[key] ?? "").includes(statement)) {
      errors.push(error);
    }
  }

  for (const { key, statement, error } of requiredVisibleV030Statements) {
    if (!extractQualifyingMarkdownProse(documents[key] ?? "").includes(statement)) {
      errors.push(error);
    }
  }

  for (const {
    key,
    label,
    statement,
  } of [
    { key: "readme", label: "README", statement: releaseChannelStatement },
    {
      key: "readmeZh",
      label: "Simplified Chinese README",
      statement: releaseChannelStatementZh,
    },
  ]) {
    const source = documents[key] ?? "";
    const destinations = extractInlineMarkdownLinkDestinations(source);
    if (!destinations.includes(storeUrl)) {
      errors.push(
        `${label} is missing the canonical Chrome Web Store Markdown link.`,
      );
    }
    if (!destinations.includes(releaseUrl)) {
      errors.push(`${label} is missing the canonical GitHub release Markdown link.`);
    }
    if (!extractQualifyingMarkdownProse(source).includes(statement)) {
      errors.push(`${label} is missing the Chrome Web Store release-lag guidance.`);
    }
  }

  const privacy = normalizeWhitespace(documents.privacy);
  const visiblePrivacy = extractQualifyingMarkdownProse(documents.privacy);
  const security = normalizeWhitespace(documents.security);
  const visibleSecurity = extractQualifyingMarkdownProse(documents.security);
  const listingSource = documents.listing ?? "";
  const listing = normalizeWhitespace(listingSource);
  const visibleListing = extractQualifyingMarkdownProse(listingSource);
  const listingDestinations = extractInlineMarkdownLinkDestinations(listingSource);

  if (!privacy.includes(limitedUseStatement)) {
    errors.push("Privacy policy is missing the Limited Use compliance statement.");
  }

  if (!visiblePrivacy.includes(historyRetentionStatement)) {
    errors.push(
      "Privacy policy is missing the typed per-instance history disclosure.",
    );
  }

  if (!security.includes(securityCondition)) {
    errors.push(
      "Security policy must make private vulnerability reporting conditional on Security-tab availability.",
    );
  }

  if (!security.includes(securityFallback)) {
    errors.push("Security policy is missing the non-disclosing private-contact fallback.");
  }

  if (!visibleSecurity.includes(credentialBoundaryStatement)) {
    errors.push(
      "Security policy is missing the practical side-panel credential boundary.",
    );
  }

  if (security.toLowerCase().includes("never returned to the side panel")) {
    errors.push(
      "Security policy overstates isolation from the trusted side-panel context.",
    );
  }

  for (const defaultValue of requiredListingDefaults) {
    if (!listing.includes(defaultValue)) {
      errors.push(`Store listing is missing required default: ${defaultValue}.`);
    }
  }

  for (const { destination, error } of requiredListingLinks) {
    if (!listingDestinations.includes(destination)) {
      errors.push(error);
    }
  }

  if (!visibleListing.includes(paceAvailabilityStatement)) {
    errors.push(
      "Store listing is missing the reset-time-or-duration pace qualification.",
    );
  }

  if (!visibleListing.includes(EXPECTED_DESCRIPTION)) {
    errors.push(
      "Store listing short description must exactly match the manifest description.",
    );
  }

  if (!listing.includes(publicRouteGate)) {
    errors.push(
      "Store listing must defer public-route verification until after repository visibility is public.",
    );
  }

  if (!documents.license?.includes("Copyright (c) 2026 TiantianFlow")) {
    errors.push("LICENSE is missing the 2026 TiantianFlow copyright notice.");
  }

  return errors;
}
