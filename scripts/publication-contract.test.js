import { describe, expect, it } from "vitest";
import { validatePublicationDocuments } from "./publication-contract.mjs";

const issuesUrl = "https://github.com/wjcjttl/ai-limits/issues";
const issuesLink = `[GitHub Issues](${issuesUrl})`;
const securityCondition =
  "If GitHub private vulnerability reporting is available in the repository's **Security** tab, use it for sensitive reports.";
const securityFallback =
  "If that feature is unavailable, open a minimal issue requesting a private contact route without disclosing the vulnerability or sensitive details.";
const publicRouteGate =
  "After the repository is public and before Chrome Web Store submission, verify the homepage, privacy policy, and support URLs are reachable in a signed-out browser.";
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
    value: "Homepage: https://github.com/wjcjttl/ai-limits",
    error:
      "Store listing is missing required default: Homepage: https://github.com/wjcjttl/ai-limits.",
  },
  {
    value:
      "Privacy policy: https://github.com/wjcjttl/ai-limits/blob/main/PRIVACY.md",
    error:
      "Store listing is missing required default: Privacy policy: https://github.com/wjcjttl/ai-limits/blob/main/PRIVACY.md.",
  },
  {
    value: "Support: https://github.com/wjcjttl/ai-limits/issues",
    error:
      "Store listing is missing required default: Support: https://github.com/wjcjttl/ai-limits/issues.",
  },
  {
    value: "Remote hosted code: No",
    error: "Store listing is missing required default: Remote hosted code: No.",
  },
];

const valid = {
  readme: issuesLink,
  privacy: [
    issuesLink,
    "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.",
  ].join("\n"),
  security: [issuesLink, securityCondition, securityFallback].join("\n"),
  listing: [
    ...listingDefaults.map(({ value }) => value),
    publicRouteGate,
  ].join("\n"),
  license: "MIT License\n\nCopyright (c) 2026 wjcjttl",
};

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

describe("publication content", () => {
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
        readme: `[Report a problem](${issuesUrl})`,
      }),
    ).toEqual([]);
  });

  it("accepts a real canonical Issues link with a nested label and title", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        readme: `[Report [a bug]](<${issuesUrl}> "Issue tracker")`,
      }),
    ).toEqual([]);
  });

  it.each(listingDefaults)("rejects an omitted $value listing default", ({ value, error }) => {
    const errors = validatePublicationDocuments({
      ...valid,
      listing: valid.listing.replace(value, ""),
    });
    expect(errors).toContain(error);
  });

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
        "GitHub Issues is enabled and reachable at https://github.com/wjcjttl/ai-limits/issues.",
      ),
    });
    expect(errors).toContain(
      "Store listing must defer public-route verification until after repository visibility is public.",
    );
  });

  it("requires the license notice", () => {
    const errors = validatePublicationDocuments({ ...valid, license: "MIT License" });
    expect(errors).toContain("LICENSE is missing the 2026 wjcjttl copyright notice.");
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
