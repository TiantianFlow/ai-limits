import MarkdownIt from "markdown-it";

const issuesUrl = "https://github.com/wjcjttl/ai-limits/issues";
const storeUrl =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";
const releaseUrl = "https://github.com/wjcjttl/ai-limits/releases/latest";
const releaseChannelStatement =
  "Chrome Web Store releases can lag while review or publishing is pending; the Store badge shows the currently published version.";
const releaseChannelStatementZh =
  "Chrome 应用商店版本可能因审核或发布流程而滞后；应用商店徽章显示当前已发布的版本。";
const limitedUseStatement =
  "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.";
const historyRetentionStatement =
  "Successful normalized quota observations are stored locally for up to 30 days, subject to a 1,024-observation per-provider safety cap.";
const securityCondition =
  "If GitHub private vulnerability reporting is available in the repository's **Security** tab, use it for sensitive reports.";
const securityFallback =
  "If that feature is unavailable, open a minimal issue requesting a private contact route without disclosing the vulnerability or sensitive details.";
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

const requiredListingDefaults = [
  "Category: Productivity",
  "Primary language: English",
  "Mature content: No",
  "Distribution: Public, all regions",
  "Pricing: Free",
  "Homepage: https://github.com/wjcjttl/ai-limits",
  "Privacy policy: https://github.com/wjcjttl/ai-limits/blob/main/PRIVACY.md",
  `Support: ${issuesUrl}`,
  "Remote hosted code: No",
];
const requiredListingLinks = [
  {
    destination: "store-assets/README.md",
    error:
      "Store listing is missing the root-relative artwork instructions link: store-assets/README.md.",
  },
  {
    destination: "PRIVACY.md",
    error: "Store listing is missing the root-relative privacy link: PRIVACY.md.",
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

function extractVisibleRenderedProse(document) {
  const visible = [];
  let commentOpen = false;

  for (const blockToken of markdown.parse(document ?? "", {})) {
    if (blockToken.type !== "inline") {
      continue;
    }

    for (const token of blockToken.children ?? []) {
      if (token.type === "html_inline") {
        commentOpen = updateHtmlCommentState(token.content, commentOpen);
        continue;
      }

      if (commentOpen) {
        commentOpen = updateHtmlCommentState(token.content, commentOpen);
        continue;
      }

      if (token.type === "text") {
        visible.push(token.content);
      } else if (token.type === "softbreak" || token.type === "hardbreak") {
        visible.push(" ");
      }
    }
  }

  return normalizeWhitespace(visible.join(" "));
}

export function validatePublicationDocuments(documents) {
  const errors = [];
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
    if (!extractVisibleRenderedProse(documents[key] ?? "").includes(statement)) {
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
    if (!extractVisibleRenderedProse(source).includes(statement)) {
      errors.push(`${label} is missing the Chrome Web Store release-lag guidance.`);
    }
  }

  const privacy = normalizeWhitespace(documents.privacy);
  const visiblePrivacy = extractVisibleRenderedProse(documents.privacy);
  const security = normalizeWhitespace(documents.security);
  const listingSource = documents.listing ?? "";
  const listing = normalizeWhitespace(listingSource);
  const visibleListing = extractVisibleRenderedProse(listingSource);
  const listingDestinations = extractInlineMarkdownLinkDestinations(listingSource);

  if (!privacy.includes(limitedUseStatement)) {
    errors.push("Privacy policy is missing the Limited Use compliance statement.");
  }

  if (!visiblePrivacy.includes(historyRetentionStatement)) {
    errors.push(
      "Privacy policy is missing the 30-day local quota-history disclosure.",
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

  if (!listing.includes(publicRouteGate)) {
    errors.push(
      "Store listing must defer public-route verification until after repository visibility is public.",
    );
  }

  if (!documents.license?.includes("Copyright (c) 2026 wjcjttl")) {
    errors.push("LICENSE is missing the 2026 wjcjttl copyright notice.");
  }

  return errors;
}
