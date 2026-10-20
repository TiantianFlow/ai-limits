import { beforeAll, describe, expect, it } from "vitest";

import { providerNames as catalogNames } from "../domain/provider-presentation";
import {
  PROVIDER_COUNT_CLAIMS,
  REQUIRED_DISCLOSURES,
  findDisclosureBlock,
  readPublicationDocuments,
  validatePublicationDocuments,
} from "./publication-contract.mjs";

const providerNames = Object.values(catalogNames);
const issuesUrl = "https://github.com/TiantianFlow/ai-limits/issues";
const storeUrl =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";
const releaseUrl = "https://github.com/TiantianFlow/ai-limits/releases/latest";

/** The repository's own documents are the valid baseline. */
let real;
beforeAll(async () => {
  real = await readPublicationDocuments();
});

function validate(overrides = {}, options = { providerNames }) {
  return validatePublicationDocuments({ ...real, ...overrides }, options);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deletes a fact from Markdown source, across line wraps and emphasis marks. */
function withoutFact(document, fact) {
  const pattern = fact instanceof RegExp
    ? new RegExp(fact.source, `${fact.flags.replace("g", "")}g`)
    : new RegExp(
      [...fact].map((character) =>
        /\s/.test(character) ? "\\s+" : escapeRegExp(character),
      ).join("[*_]*"),
      "gi",
    );
  return document.replace(pattern, "");
}

/** Replaces the source paragraph that carries the disclosure. */
function replaceDisclosureParagraph(key, facts, replacement) {
  const paragraphs = real[key].split(/\n\s*\n/);
  const index = paragraphs.findIndex((paragraph) =>
    findDisclosureBlock(paragraph, facts),
  );
  expect(index, `no paragraph in ${key} carries ${facts.join(", ")}`).not.toBe(-1);
  paragraphs[index] = replacement(paragraphs[index]);
  return { [key]: paragraphs.join("\n\n") };
}

const elevenLabsDestination = REQUIRED_DISCLOSURES.find(({ facts }) =>
  facts.includes("xi-api-key") && facts.includes("read-only"),
);

describe("publication content", () => {
  it("accepts the repository's documents, checked against the provider catalog", () => {
    expect(validate()).toEqual([]);
  });

  it("names every disclosure's facts in one visible block of the real documents", () => {
    for (const { key, facts } of REQUIRED_DISCLOSURES) {
      expect(findDisclosureBlock(real[key], facts), `${key}: ${facts.join(" | ")}`)
        .toBeDefined();
    }
  });

  it.each(
    REQUIRED_DISCLOSURES.flatMap(({ key, facts, error }) =>
      facts.map((fact) => ({ key, fact: String(fact), raw: fact, error })),
    ),
  )("reports $key missing the fact \"$fact\"", ({ key, raw, error }) => {
    expect(validate({ [key]: withoutFact(real[key], raw) })).toContain(error);
  });

  it("accepts a disclosure reworded around its facts", () => {
    const { key, facts } = elevenLabsDestination;
    expect(
      validate(
        replaceDisclosureParagraph(key, facts, () =>
          "For the read-only subscription request, AI Limits sends the saved key " +
          "as the XI-API-KEY header, and only to https://api.elevenlabs.io.",
        ),
      ),
    ).toEqual([]);
  });

  it("requires a disclosure's facts to share one paragraph", () => {
    const { key, facts, error } = elevenLabsDestination;
    expect(
      validate(
        replaceDisclosureParagraph(key, facts, () =>
          "AI Limits sends the saved key only to https://api.elevenlabs.io.\n\n" +
          "It travels as the xi-api-key header for the read-only subscription request.",
        ),
      ),
    ).toContain(error);
  });

  it.each([
    ["an HTML comment", (paragraph) => `<!--\n${paragraph}\n-->`],
    ["a raw HTML block", (paragraph) => `<div>\n\n${paragraph}\n\n</div>`],
    ["a details element", (paragraph) => `<details>\n\n${paragraph}\n\n</details>`],
    ["an inline span", (paragraph) => `<span>${paragraph}</span>`],
    ["an unclosed span", (paragraph) => `<span>${paragraph}`],
    ["a self-closed custom element", (paragraph) => `<x-secret hidden/>${paragraph}`],
    ["a fenced code block", (paragraph) => `\`\`\`text\n${paragraph}\n\`\`\``],
    ["indented code", (paragraph) => paragraph.replace(/^/gm, "    ")],
  ])("does not count a disclosure hidden in %s", (_context, hide) => {
    const { key, facts, error } = elevenLabsDestination;
    expect(validate(replaceDisclosureParagraph(key, facts, hide))).toContain(error);
  });

  it.each([
    ["after a closed span", (paragraph) => `<span>Note</span> ${paragraph}`],
    ["after a line break tag", (paragraph) => `<br/>${paragraph}`],
    ["after an image", (paragraph) => `<img src="x.png"/> ${paragraph}`],
    ["with a fact in backticks", (paragraph) => paragraph.replace("xi-api-key", "`xi-api-key`")],
  ])("counts a disclosure %s", (_context, edit) => {
    const { key, facts } = elevenLabsDestination;
    expect(validate(replaceDisclosureParagraph(key, facts, edit))).toEqual([]);
  });

  describe("provider counts", () => {
    it.each(PROVIDER_COUNT_CLAIMS)("reports a missing count in $label", ({ key, pattern, label }) => {
      expect(validate({ [key]: withoutFact(real[key], pattern) })).toContain(
        `${label} is missing its provider count.`,
      );
    });

    it("reports a count that disagrees with the catalog", () => {
      expect(validate({}, { providerNames: [...providerNames, "Example AI"] })).toEqual(
        expect.arrayContaining(
          PROVIDER_COUNT_CLAIMS.map(({ label }) =>
            `${label} says ${providerNames.length} providers; the catalog has ${providerNames.length + 1}.`,
          ),
        ),
      );
    });

    it("reports a provider list that leaves out a catalog provider", () => {
      const [first] = providerNames;
      const errors = validate({}, {
        providerNames: [...providerNames.slice(1), "Example AI"],
      });
      expect(errors).toContain("README provider list does not name: Example AI.");
      expect(errors.filter((error) => error.includes(first))).toEqual([]);
    });

    it("checks only that the claims exist when no catalog is passed", () => {
      expect(validate({}, {})).toEqual([]);
    });
  });

  describe("links", () => {
    it.each([
      ["readme", "README"],
      ["privacy", "Privacy policy"],
      ["security", "Security policy"],
    ])("requires a rendered GitHub Issues link in %s", (key, label) => {
      const error = `${label} is missing the canonical GitHub Issues Markdown link.`;
      const stripped = real[key].replaceAll(`](${issuesUrl})`, "]");
      expect(validate({ [key]: stripped })).toContain(error);
      for (const hidden of [
        `<!-- [Issues](${issuesUrl}) -->`,
        `<!-- [Issues](${issuesUrl})`,
        `Note <!-- [Issues](${issuesUrl})`,
        `Note <!--\n[Issues](${issuesUrl})\n-->`,
        `\`[Issues](${issuesUrl})\``,
        `\`\`\`markdown\n[Issues](${issuesUrl})\n\`\`\``,
        `<div>\n[Issues](${issuesUrl})\n</div>`,
        `<div data-support="[Issues](${issuesUrl})"></div>`,
        `<script>\nconst support = "[Issues](${issuesUrl})";\n</script>`,
        `\\[Issues](${issuesUrl})`,
      ]) {
        expect(validate({ [key]: `${stripped}\n\n${hidden}\n` })).toContain(error);
      }
      expect(validate({ [key]: `${stripped}\n\nReport it in [our tracker](${issuesUrl}).\n` }))
        .not.toContain(error);
      expect(validate({ [key]: `${stripped}\n\n\`literal <!--\` then [our tracker](${issuesUrl}).\n` }))
        .not.toContain(error);
    });

    it.each(["readme", "readmeZh"])("requires the Store and release links in %s", (key) => {
      const label = key === "readme" ? "README" : "Simplified Chinese README";
      expect(validate({ [key]: real[key].replaceAll(`(${storeUrl})`, "") })).toContain(
        `${label} is missing the canonical Chrome Web Store Markdown link.`,
      );
      expect(validate({ [key]: real[key].replaceAll(`(${releaseUrl})`, "") })).toContain(
        `${label} is missing the canonical GitHub release Markdown link.`,
      );
    });

    it.each([
      ["readme", "FAQ.md", "README is missing the root-relative FAQ link: FAQ.md."],
      ["faq", "FAQ.zh-CN.md", "English FAQ is missing the Simplified Chinese FAQ link: FAQ.zh-CN.md."],
      ["faqZh", "FAQ.md", "Simplified Chinese FAQ is missing the English FAQ link: FAQ.md."],
    ])("requires the FAQ navigation link in %s", (key, destination, error) => {
      expect(validate({ [key]: real[key].replaceAll(`](${destination})`, "]") })).toContain(error);
    });

    it("rejects repository URLs under another owner", () => {
      expect(
        validate({ readme: `${real.readme}\nhttps://github.com/someone-else/ai-limits\n` }),
      ).toContain("Publication documents must use the canonical TiantianFlow repository URL.");
    });

    it.each(["../README.md", "../../PRIVACY.md"])(
      "requires the listing-relative link %s",
      (destination) => {
        expect(
          validate({ listing: real.listing.replaceAll(`](${destination})`, "]") }),
        ).toEqual(expect.arrayContaining([expect.stringContaining(`link: ${destination}.`)]));
      },
    );
  });

  describe("store listing", () => {
    it("requires the manifest's short description verbatim", () => {
      const description = real.listing.match(/Track subscription usage[^\n]*/)[0];
      expect(validate({ listing: real.listing.replace(description, description.replace("Track", "Watch")) }))
        .toContain("Store listing short description must exactly match the manifest description.");
    });

    it("requires each dashboard default", () => {
      expect(validate({ listing: real.listing.replace("Pricing: Free", "Pricing: TBD") }))
        .toContain("Store listing is missing required default: Pricing: Free.");
    });

    it.each([
      ["listing", "## Detailed description", "English"],
      ["listingZh", "## 详细说明", "Simplified Chinese"],
    ])("keeps provider brands out of the %s detailed description", (key, heading, label) => {
      const withBrand = real[key].replace(heading, `${heading}\n\nNow with ${providerNames.at(-1)}.`);
      expect(validate({ [key]: withBrand })).toContain(
        `${label} Store detailed description must not enumerate provider brands.`,
      );
    });

    it("requires the supported-providers URL in the detailed description", () => {
      expect(
        validate({
          listing: real.listing.replaceAll(
            "https://github.com/TiantianFlow/ai-limits/blob/main/SUPPORTED_PROVIDERS.md",
            "",
          ),
        }),
      ).toContain("English Store detailed description is missing the direct supported-providers URL.");
    });
  });

  it("rejects placeholder copy", () => {
    expect(validate({ privacy: `${real.privacy}\nSee pre-publication acceptance notes.\n` }))
      .toContain("Privacy policy still contains pre-publication placeholder copy.");
  });

  it("rejects the claim that keys never reach the side panel", () => {
    expect(validate({ security: `${real.security}\nKeys are never returned to the side panel.\n` }))
      .toContain("Security policy overstates isolation from the trusted side-panel context.");
  });

  it("requires the license notice", () => {
    expect(validate({ license: "MIT License" })).toContain(
      "LICENSE is missing the 2026 TiantianFlow copyright notice.",
    );
  });
});
