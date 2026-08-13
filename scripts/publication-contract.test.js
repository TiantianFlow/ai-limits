import { describe, expect, it } from "vitest";
import { validatePublicationDocuments } from "./publication-contract.mjs";

const issuesUrl = "https://github.com/wjcjttl/ai-limits/issues";
const issuesLink = `[GitHub Issues](${issuesUrl})`;
const storeUrl =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";
const storeLink = `[Chrome Web Store](${storeUrl})`;
const releaseUrl = "https://github.com/wjcjttl/ai-limits/releases/latest";
const releaseLink = `[GitHub release](${releaseUrl})`;
const faqLink = "[FAQ](FAQ.md)";
const releaseChannelStatement =
  "Chrome Web Store releases can lag while review or publishing is pending; the Store badge shows the currently published version.";
const releaseChannelStatementZh =
  "Chrome 应用商店版本可能因审核或发布流程而滞后；应用商店徽章显示当前已发布的版本。";
const historyRetentionStatement =
  "Successful normalized quota observations are stored locally for up to 30 days, subject to a 1,024-observation per-provider safety cap.";
const uncappedHistoryRetentionStatement =
  "Successful normalized quota observations are stored locally for up to 30 days.";
const securityCondition =
  "If GitHub private vulnerability reporting is available in the repository's **Security** tab, use it for sensitive reports.";
const securityFallback =
  "If that feature is unavailable, open a minimal issue requesting a private contact route without disclosing the vulnerability or sensitive details.";
const publicRouteGate =
  "After the repository is public and before Chrome Web Store submission, verify the homepage, privacy policy, and support URLs are reachable in a signed-out browser.";
const paceAvailabilityStatement =
  "For quota windows with a reliable reset time plus either a start time or window duration, a pace signal compares quota consumed with elapsed time.";
const kimiAutoRefreshStatement =
  "Kimi automatic refresh is best-effort and may not always work; a manual Connect or Refresh may briefly open an inactive Kimi tab in the background to recover the session.";
const kimiAutoRefreshStatementZh =
  "Kimi 自动刷新属于尽力而为，并不保证每次都能成功；手动 Connect 或 Refresh 可能会在后台短暂打开一个非活动 Kimi 标签页以恢复会话。";
const listingLinks = [
  {
    markdown: "[Artwork instructions](store-assets/README.md)",
    error:
      "Store listing is missing the root-relative artwork instructions link: store-assets/README.md.",
  },
  {
    markdown: "[Privacy policy](PRIVACY.md)",
    error: "Store listing is missing the root-relative privacy link: PRIVACY.md.",
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
  readme: `${issuesLink}\n${faqLink}\n${storeLink}\n${releaseLink}\n${releaseChannelStatement}`,
  readmeZh: `[常见问题](FAQ.zh-CN.md)\n${storeLink}\n${releaseLink}\n${releaseChannelStatementZh}`,
  faq: `English | [简体中文](FAQ.zh-CN.md)\n${kimiAutoRefreshStatement}`,
  faqZh: `[English](FAQ.md) | 简体中文\n${kimiAutoRefreshStatementZh}`,
  privacy: [
    issuesLink,
    "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.",
    historyRetentionStatement,
  ].join("\n"),
  security: [issuesLink, securityCondition, securityFallback].join("\n"),
  listing: [
    ...listingDefaults.map(({ value }) => value),
    ...listingLinks.map(({ markdown }) => markdown),
    paceAvailabilityStatement,
    publicRouteGate,
  ].join("\n"),
  license: "MIT License\n\nCopyright (c) 2026 wjcjttl",
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

  it("requires the privacy policy to disclose the 30-day local quota-history limit", () => {
    const errors = validatePublicationDocuments({
      ...valid,
      privacy: valid.privacy.replace(historyRetentionStatement, ""),
    });
    expect(errors).toContain(
      "Privacy policy is missing the 30-day local quota-history disclosure.",
    );
  });

  it("requires the local quota-history limit to disclose the per-provider safety cap", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          historyRetentionStatement,
          uncappedHistoryRetentionStatement,
        ),
      }),
    ).toContain(
      "Privacy policy is missing the 30-day local quota-history disclosure.",
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
        "Privacy policy is missing the 30-day local quota-history disclosure.",
      );
    },
  );

  it("accepts the quota-history disclosure when ordinary prose wraps across lines", () => {
    expect(
      validatePublicationDocuments({
        ...valid,
        privacy: valid.privacy.replace(
          historyRetentionStatement,
          "Successful normalized quota observations are stored locally for up to 30 days,\nsubject to a 1,024-observation per-provider safety cap.",
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
    "rejects a missing root-relative listing link from $markdown",
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
