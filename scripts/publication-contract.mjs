import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import MarkdownIt from "markdown-it";

import { EXPECTED_DESCRIPTION } from "./artifact-contract.mjs";

const issuesUrl = "https://github.com/TiantianFlow/ai-limits/issues";
const supportedProvidersUrl =
  "https://github.com/TiantianFlow/ai-limits/blob/main/SUPPORTED_PROVIDERS.md";
const supportedProvidersUrlZh =
  "https://github.com/TiantianFlow/ai-limits/blob/main/SUPPORTED_PROVIDERS.zh-CN.md";
const storeUrl =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";
const releaseUrl = "https://github.com/TiantianFlow/ai-limits/releases/latest";
const canonicalRepositoryOwner = "TiantianFlow";
const repositoryOwnerPatterns = [
  /https:\/\/github\.com\/([^/\s)]+)\/ai-limits\b/gi,
  /https:\/\/img\.shields\.io\/github\/(?:license|v\/release)\/([^/\s)]+)\/ai-limits\b/gi,
];
const providerBrandPattern =
  /\b(?:ChatGPT|Claude|Kimi|Cursor|Grok|Mistral|Perplexity|ElevenLabs|New API|LiteLLM|ClawRouter|sub2api|LLM Proxy|DeepSeek|Moonshot|DeepInfra|Fireworks|OpenAI|GroqCloud|OpenRouter|Droid|GLM|Z\.ai|Warp)\b/i;

/**
 * Disclosures the Chrome Web Store review and the privacy policy rely on. Each
 * one passes when a single visible paragraph or list item carries every fact,
 * case-insensitively, so the wording around the facts can change freely. A
 * fact is a phrase or a RegExp; pick the words a reviewer would look for, not
 * the glue between them.
 */
export const REQUIRED_DISCLOSURES = [
  {
    key: "readme",
    facts: ["Chrome Web Store releases can lag", "Store badge shows the currently published version"],
    error: "README is missing the Chrome Web Store release-lag guidance.",
  },
  {
    key: "readmeZh",
    facts: ["Chrome 应用商店版本可能", "滞后", "应用商店徽章显示当前已发布的版本"],
    error: "Simplified Chinese README is missing the Chrome Web Store release-lag guidance.",
  },
  {
    key: "faq",
    facts: ["Kimi automatic refresh", "best-effort", "inactive Kimi tab"],
    error: "English FAQ is missing the rendered Kimi automatic-refresh limitation.",
  },
  {
    key: "faqZh",
    facts: ["Kimi 自动刷新", "尽力而为", "非活动 Kimi 标签页"],
    error: "Simplified Chinese FAQ is missing the rendered Kimi automatic-refresh limitation.",
  },
  {
    key: "faq",
    facts: ["Kimi scheduled refresh never opens a tab", "at most one inactive temporary Kimi tab", "up to 30 seconds", "closes only the tab it created"],
    error: "English FAQ is missing the bounded Kimi tab policy.",
  },
  {
    key: "faqZh",
    facts: ["Kimi 定时刷新绝不会打开标签页", "最多打开一个非活动的临时 Kimi 标签页", "最多等待 30 秒", "只关闭它自己创建的标签页"],
    error: "Simplified Chinese FAQ is missing the bounded Kimi tab policy.",
  },
  {
    key: "faq",
    facts: ["ElevenLabs", "user-created API key", "stores it locally", "does not open an ElevenLabs tab"],
    error: "English FAQ is missing the rendered ElevenLabs connection and refresh statement.",
  },
  {
    key: "faqZh",
    facts: ["ElevenLabs", "用户创建的 API 密钥", "保存在本地", "不会打开 ElevenLabs 标签页"],
    error: "Simplified Chinese FAQ is missing the rendered ElevenLabs connection and refresh statement.",
  },
  {
    key: "privacy",
    facts: ["stored separately in chrome.storage.local", "restricts to trusted extension contexts"],
    error: "Privacy policy is missing the trusted-context API-key storage disclosure.",
  },
  {
    key: "faqZh",
    facts: ["chrome.storage.local", "限制为仅受信任的扩展上下文"],
    error: "Simplified Chinese FAQ is missing the trusted-context key-storage disclosure.",
  },
  {
    key: "privacy",
    facts: ["only to https://api.elevenlabs.io", "xi-api-key", "read-only"],
    error: "Privacy policy is missing the ElevenLabs key destination disclosure.",
  },
  {
    key: "faqZh",
    facts: ["只会作为 xi-api-key 请求头发送到 https://api.elevenlabs.io", "只读"],
    error: "Simplified Chinese FAQ is missing the ElevenLabs key destination disclosure.",
  },
  {
    key: "privacy",
    facts: ["not OS-keychain encrypted", "unlocked Chrome profile"],
    error: "Privacy policy is missing the local API-key inspection limitation.",
  },
  {
    key: "faqZh",
    facts: ["不受操作系统钥匙串加密保护", "未锁定 Chrome 配置文件"],
    error: "Simplified Chinese FAQ is missing the local API-key inspection limitation.",
  },
  {
    key: "privacy",
    facts: ["never included in", "usage state", "History", "screenshots", "reports", "logs", "analytics", "developer backend"],
    error: "Privacy policy is missing the API-key exclusion boundaries.",
  },
  {
    key: "faqZh",
    facts: ["绝不会", "用量状态", "History", "截图", "报告", "日志", "分析", "开发者后端"],
    error: "Simplified Chinese FAQ is missing the ElevenLabs key exclusion boundaries.",
  },
  {
    key: "privacy",
    facts: ["rejected API key stops", "scheduled requests", "stale normalized usage", "remain until replacement or deletion"],
    error: "Privacy policy is missing the rejected API-key behavior.",
  },
  {
    key: "faqZh",
    facts: ["被拒绝", "停止定时 ElevenLabs 请求", "过期的标准化用量"],
    error: "Simplified Chinese FAQ is missing the rejected ElevenLabs key behavior.",
  },
  {
    key: "privacy",
    facts: ["Disconnect", "Delete all local data", "uninstall", "clearing extension storage", "deletes the saved API key"],
    error: "Privacy policy is missing the complete API-key deletion lifecycle.",
  },
  {
    key: "faqZh",
    facts: ["断开 ElevenLabs", "Delete all local data", "卸载", "清除扩展存储", "删除保存的密钥"],
    error: "Simplified Chinese FAQ is missing the complete ElevenLabs key-deletion lifecycle.",
  },
  {
    key: "privacy",
    facts: ["cannot revoke", "final-owner host permission", "local instance deletion remains authoritative", "retry"],
    error: "Privacy policy is missing the permission-cleanup failure boundary.",
  },
  {
    key: "faqZh",
    facts: ["无法撤销", "最后一个所有者的主机权限", "本地实例删除仍然有效", "重试"],
    error: "Simplified Chinese FAQ is missing the permission-cleanup failure boundary.",
  },
  {
    key: "faq",
    facts: ["Connect", "scheduled automatic refresh", "typed History observation", "graphs quota metrics", "balance-first providers", "not graphed"],
    error: "English FAQ introduction is missing typed History and History graph scope behavior.",
  },
  {
    key: "faqZh",
    facts: ["Connect", "定时自动刷新", "标准化类型化 History 观测", "绘制配额指标", "以余额为主的服务商的余额", "不会绘图"],
    error: "Simplified Chinese FAQ introduction is missing typed History and History graph scope behavior.",
  },
  {
    key: "readme",
    facts: ["multiple New API instances", "its own", "relay key", "History"],
    error: "README is missing the rendered multi-instance New API disclosure.",
  },
  {
    key: "readmeZh",
    facts: ["多个 New API 实例", "Relay Key", "History"],
    error: "Simplified Chinese README is missing the rendered multi-instance New API disclosure.",
  },
  {
    key: "faq",
    facts: ["same origin", "browser-global origin permission", "never share a relay key"],
    error: "English FAQ is missing the same-origin New API isolation disclosure.",
  },
  {
    key: "faqZh",
    facts: ["同一来源", "浏览器全局来源权限", "绝不会共享 Relay Key"],
    error: "Simplified Chinese FAQ is missing the same-origin New API isolation disclosure.",
  },
  {
    key: "supported",
    facts: ["multiple independent instances", "relay key", "deletion lifecycle"],
    error: "Supported providers is missing the New API instance lifecycle.",
  },
  {
    key: "supported",
    facts: ["browser-global origin grant", "remain independent"],
    error: "Supported providers is missing the shared-origin boundary.",
  },
  {
    key: "supportedZh",
    facts: ["多个相互独立的实例", "Relay Key", "删除生命周期"],
    error: "Simplified Chinese supported providers is missing the New API instance lifecycle.",
  },
  {
    key: "supportedZh",
    facts: ["浏览器全局来源授权", "相互独立"],
    error: "Simplified Chinese supported providers is missing the shared-origin boundary.",
  },
  {
    key: "privacy",
    facts: ["complies with the Chrome Web Store User Data Policy", "Limited Use requirements"],
    error: "Privacy policy is missing the Limited Use compliance statement.",
  },
  {
    key: "privacy",
    facts: ["stored per instance", "up to 30 days", "1,024-observation per-instance safety cap"],
    error: "Privacy policy is missing the typed per-instance history disclosure.",
  },
  {
    key: "privacy",
    facts: ["newest 48 hours", "collection resolution", "latest observation in each UTC hour"],
    error: "Privacy policy is missing the history compaction policy.",
  },
  {
    key: "privacy",
    facts: ["quota metrics", "balance-first providers", "not graphed"],
    error: "Privacy policy is missing the History graph scope disclosure.",
  },
  {
    key: "privacy",
    facts: ["never stores credentials or raw provider responses"],
    error: "Privacy policy is missing the credential and raw-response exclusion.",
  },
  {
    key: "privacy",
    facts: ["spend counters and balances", "not raw payment transaction history"],
    error: "Privacy policy is missing the normalized financial-data distinction.",
  },
  {
    key: "privacy",
    facts: ["Externally removing a permission", "permission-required", "retaining"],
    error: "Privacy policy is missing the external-permission retention behavior.",
  },
  {
    key: "privacy",
    facts: [/Disconnect deletes[^.]*credential[^.]*History/i, "before permission cleanup", "shared origin remains granted", "final-owner removal is best-effort", "retry"],
    error: "Privacy policy is missing the instance disconnect and final-owner behavior.",
  },
  {
    key: "security",
    facts: ["If GitHub private vulnerability reporting is available", "Security tab"],
    error: "Security policy must make private vulnerability reporting conditional on Security-tab availability.",
  },
  {
    key: "security",
    facts: ["If that feature is unavailable", "private contact route", "without disclosing"],
    error: "Security policy is missing the non-disclosing private-contact fallback.",
  },
  {
    key: "security",
    facts: ["never include saved API keys", "does not render them", "copy them into reports, logs, or History"],
    error: "Security policy is missing the practical side-panel credential boundary.",
  },
  {
    key: "listing",
    facts: ["Authentication information: Yes", "provider API keys", "saves locally"],
    error: "Store listing is missing the saved provider-key authentication disclosure.",
  },
  {
    key: "listing",
    facts: ["retained per instance", "graphs quota metrics", "balance-first providers", "ungraphed"],
    error: "Store listing is missing typed history and History graph scope behavior.",
  },
  {
    key: "listing",
    facts: ["reliable reset time", "start time or window duration", "pace signal"],
    error: "Store listing is missing the reset-time-or-duration pace qualification.",
  },
  {
    key: "listing",
    facts: ["After the repository is public", "before Chrome Web Store submission", "homepage", "privacy policy", "support URLs", "signed-out browser"],
    error: "Store listing must defer public-route verification until after repository visibility is public.",
  },
];

/**
 * Places that state how many providers AI Limits supports. `count` reads the
 * number from the match. With a provider catalog, the number must match it and
 * a `listsProviders` block must also name every provider.
 */
export const PROVIDER_COUNT_CLAIMS = [
  {
    key: "readme",
    pattern: /AI Limits supports ([a-z-]+|\d+) providers:/i,
    count: englishCount,
    listsProviders: true,
    label: "README provider list",
  },
  {
    key: "readmeZh",
    pattern: /AI Limits 支持\s*([一二三四五六七八九十]+|\d+)\s*个服务：/,
    count: chineseCount,
    listsProviders: true,
    label: "Simplified Chinese README provider list",
  },
  {
    key: "listing",
    pattern: /First Run opens with ([a-z-]+|\d+) opt-in provider rows and no prefilled usage/i,
    count: englishCount,
    label: "Store listing reviewer First Run step",
  },
  {
    key: "listing",
    pattern: /AI Limits supports (\d+) AI services/i,
    count: englishCount,
    label: "Store listing detailed description",
  },
  {
    key: "listingZh",
    pattern: /AI Limits 支持\s*(\d+)\s*个 AI 服务/,
    count: chineseCount,
    label: "Simplified Chinese store listing detailed description",
  },
];

const englishOnes = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const englishTens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** The number a count word stands for, or NaN when it is not one. */
function englishCount(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const [tens, ones, extra] = text.toLowerCase().split("-");
  const small = englishOnes.indexOf(tens);
  if (ones === undefined && small >= 0) return small;
  const tensValue = englishTens.indexOf(tens);
  const onesValue = ones === undefined ? 0 : englishOnes.indexOf(ones);
  return tensValue >= 2 && onesValue >= 0 && onesValue <= 9 && extra === undefined
    ? tensValue * 10 + onesValue
    : NaN;
}

function chineseCount(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^(?:[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])$/.test(text)) return NaN;
  const digits = "零一二三四五六七八九";
  const [tens, ones] = text.includes("十") ? text.split("十") : ["", text];
  return (text.includes("十") ? (tens ? digits.indexOf(tens) : 1) * 10 : 0) +
    (ones ? digits.indexOf(ones) : 0);
}

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

function extractQualifyingMarkdownBlocks(document) {
  // Publication disclosures must be ordinary Markdown prose. markdown-it gives
  // us source-authored HTML boundaries; tracking those elements keeps all of
  // their contents ineligible without trying to emulate browser CSS. Each
  // paragraph, list item paragraph, heading or table cell is one block.
  const blocks = [];
  const rawHtmlElementStack = [];

  for (const blockToken of markdown.parse(document ?? "", {})) {
    if (blockToken.type === "html_block") {
      updateRawHtmlElementStack(blockToken.content, rawHtmlElementStack);
      continue;
    }

    if (blockToken.type !== "inline") continue;

    const visible = [];
    for (const token of blockToken.children ?? []) {
      if (token.type === "html_inline") {
        updateRawHtmlElementStack(token.content, rawHtmlElementStack);
      } else if (
        (token.type === "text" || token.type === "code_inline") &&
        rawHtmlElementStack.length === 0
      ) {
        visible.push(token.content);
      } else if (
        (token.type === "softbreak" || token.type === "hardbreak") &&
        rawHtmlElementStack.length === 0
      ) {
        visible.push(" ");
      }
    }

    const block = normalizeWhitespace(visible.join("")).trim();
    if (block) blocks.push(block);
  }

  return blocks;
}

function extractQualifyingMarkdownProse(document) {
  return extractQualifyingMarkdownBlocks(document).join(" ");
}

function extractMarkdownSection(document, startHeading, endHeading) {
  const source = document ?? "";
  const start = source.indexOf(startHeading);
  if (start === -1) return "";

  const afterStart = source.slice(start + startHeading.length);
  const end = afterStart.indexOf(endHeading);
  return end === -1 ? afterStart : afterStart.slice(0, end);
}

function hasFact(block, fact) {
  return fact instanceof RegExp
    ? fact.test(block)
    : block.toLowerCase().includes(fact.toLowerCase());
}

/** The first visible block that states every fact, or undefined. */
export function findDisclosureBlock(document, facts) {
  return extractQualifyingMarkdownBlocks(document).find((block) =>
    facts.every((fact) => hasFact(block, fact)),
  );
}

/**
 * Checks the publication documents. Pass `providerNames` (the display names
 * from the provider catalog) to also check provider counts and lists against
 * the catalog; without it only the claims' presence is checked.
 */
export function validatePublicationDocuments(documents, { providerNames } = {}) {
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

  for (const { key, facts, error } of REQUIRED_DISCLOSURES) {
    if (!findDisclosureBlock(documents[key], facts)) errors.push(error);
  }

  for (const { key, pattern, count, listsProviders, label } of PROVIDER_COUNT_CLAIMS) {
    const block = findDisclosureBlock(documents[key], [pattern]);
    if (!block) {
      errors.push(`${label} is missing its provider count.`);
      continue;
    }
    if (!providerNames) continue;
    const claimed = count(block.match(pattern)[1]);
    if (!Number.isInteger(claimed) || claimed < 0) {
      errors.push(`${label} has an unreadable provider count.`);
    } else if (claimed !== providerNames.length) {
      errors.push(
        `${label} says ${claimed} providers; the catalog has ${providerNames.length}.`,
      );
    }
    const missing = listsProviders
      ? providerNames.filter((name) => !block.includes(name))
      : [];
    if (missing.length > 0) {
      errors.push(`${label} does not name: ${missing.join(", ")}.`);
    }
  }

  for (const { key, label } of [
    { key: "readme", label: "README" },
    { key: "readmeZh", label: "Simplified Chinese README" },
  ]) {
    const destinations = extractInlineMarkdownLinkDestinations(documents[key] ?? "");
    if (!destinations.includes(storeUrl)) {
      errors.push(
        `${label} is missing the canonical Chrome Web Store Markdown link.`,
      );
    }
    if (!destinations.includes(releaseUrl)) {
      errors.push(`${label} is missing the canonical GitHub release Markdown link.`);
    }
  }

  const security = normalizeWhitespace(documents.security);
  const listingSource = documents.listing ?? "";
  const listing = normalizeWhitespace(listingSource);
  const visibleListing = extractQualifyingMarkdownProse(listingSource);
  const listingDestinations = extractInlineMarkdownLinkDestinations(listingSource);
  const listingZhSource = documents.listingZh ?? "";
  const detailedListing = extractMarkdownSection(
    listingSource,
    "## Detailed description",
    "## Permission justifications",
  );
  const detailedListingZh = extractMarkdownSection(
    listingZhSource,
    "## 详细说明",
    "## 权限说明",
  );
  const visibleDetailedListing = extractQualifyingMarkdownProse(detailedListing);
  const visibleDetailedListingZh = extractQualifyingMarkdownProse(
    detailedListingZh,
  );
  const namesProvider = (text) =>
    providerBrandPattern.test(text) ||
    (providerNames ?? []).some((name) => text.includes(name));

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

  if (!visibleListing.includes(EXPECTED_DESCRIPTION)) {
    errors.push(
      "Store listing short description must exactly match the manifest description.",
    );
  }

  if (!visibleDetailedListing.includes(supportedProvidersUrl)) {
    errors.push(
      "English Store detailed description is missing the direct supported-providers URL.",
    );
  }

  if (namesProvider(visibleDetailedListing)) {
    errors.push(
      "English Store detailed description must not enumerate provider brands.",
    );
  }

  if (!visibleDetailedListingZh.includes(supportedProvidersUrlZh)) {
    errors.push(
      "Simplified Chinese Store detailed description is missing the direct supported-providers URL.",
    );
  }

  if (namesProvider(visibleDetailedListingZh)) {
    errors.push(
      "Simplified Chinese Store detailed description must not enumerate provider brands.",
    );
  }

  if (!documents.license?.includes("Copyright (c) 2026 TiantianFlow")) {
    errors.push("LICENSE is missing the 2026 TiantianFlow copyright notice.");
  }

  return errors;
}

/** Paths of the publication documents, relative to the repository root. */
export const PUBLICATION_DOCUMENT_PATHS = {
  readme: "README.md",
  readmeZh: "README.zh-CN.md",
  faq: "FAQ.md",
  faqZh: "FAQ.zh-CN.md",
  supported: "SUPPORTED_PROVIDERS.md",
  supportedZh: "SUPPORTED_PROVIDERS.zh-CN.md",
  privacy: "PRIVACY.md",
  security: "SECURITY.md",
  listing: "store-assets/chrome-web-store/listing-en.md",
  listingZh: "store-assets/chrome-web-store/listing-zh_CN.md",
  license: "LICENSE",
};

export async function readPublicationDocuments(root = process.cwd()) {
  const entries = await Promise.all(
    Object.entries(PUBLICATION_DOCUMENT_PATHS).map(async ([key, file]) => [
      key,
      await readFile(resolve(root, file), "utf8"),
    ]),
  );
  return Object.fromEntries(entries);
}
