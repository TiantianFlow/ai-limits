const issuesUrl = "https://github.com/wjcjttl/ai-limits/issues";
const limitedUseStatement =
  "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.";
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

function normalizeWhitespace(document) {
  return (document ?? "").replace(/\s+/g, " ");
}

function stripFencedCodeBlocks(document) {
  let activeFence;

  return document
    .split(/\r?\n/)
    .map((line) => {
      if (activeFence) {
        const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (
          closingFence &&
          closingFence[1][0] === activeFence.marker &&
          closingFence[1].length >= activeFence.length
        ) {
          activeFence = undefined;
        }
        return "";
      }

      const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openingFence) {
        activeFence = {
          marker: openingFence[1][0],
          length: openingFence[1].length,
        };
        return "";
      }

      return line;
    })
    .join("\n");
}

function extractInlineMarkdownLinkDestinations(document) {
  const renderedMarkdown = stripFencedCodeBlocks(
    (document ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, ""),
  ).replace(/(`+)[\s\S]*?\1/g, "");
  const inlineLink =
    /(?<![!\\])\[(?:\\.|[^\[\]\n]|\[[^\[\]\n]*\])*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\)))?\s*\)/g;

  return [...renderedMarkdown.matchAll(inlineLink)].map(
    (match) => match[1] ?? match[2],
  );
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

  const privacy = normalizeWhitespace(documents.privacy);
  const security = normalizeWhitespace(documents.security);
  const listing = normalizeWhitespace(documents.listing);

  if (!privacy.includes(limitedUseStatement)) {
    errors.push("Privacy policy is missing the Limited Use compliance statement.");
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
