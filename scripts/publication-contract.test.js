import { describe, expect, it } from "vitest";
import { validatePublicationDocuments } from "./publication-contract.mjs";

const valid = {
  readme: "https://github.com/wjcjttl/ai-limits/issues",
  privacy: [
    "https://github.com/wjcjttl/ai-limits/issues",
    "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.",
  ].join("\n"),
  security: "https://github.com/wjcjttl/ai-limits/issues\nprivate vulnerability reporting",
  listing: "Category: Productivity\nPrimary language: English\nMature content: No\nDistribution: Public, all regions\nRemote hosted code: No",
  license: "MIT License\n\nCopyright (c) 2026 wjcjttl",
};

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

  it("accepts the final public-facing contract", () => {
    expect(validatePublicationDocuments(valid)).toEqual([]);
  });
});
