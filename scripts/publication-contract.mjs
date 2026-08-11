import MarkdownIt from "markdown-it";

const issuesUrl = "https://github.com/wjcjttl/ai-limits/issues";
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

  const privacy = normalizeWhitespace(documents.privacy);
  const visiblePrivacy = extractVisibleRenderedProse(documents.privacy);
  const security = normalizeWhitespace(documents.security);
  const listingSource = documents.listing ?? "";
  const listing = normalizeWhitespace(listingSource);
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
