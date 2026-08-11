import { describe, expect, it } from "vitest";

import { parsePreviewLanguage, previewContent } from "./copy";

describe("store artwork copy", () => {
  it("selects Simplified Chinese explicitly and defaults unknown locales to English", () => {
    expect(parsePreviewLanguage(new URLSearchParams("locale=zh_CN"))).toBe(
      "zh_CN",
    );
    expect(parsePreviewLanguage(new URLSearchParams("locale=fr"))).toBe("en");
    expect(parsePreviewLanguage(new URLSearchParams())).toBe("en");
  });

  it("keeps the Chinese media honest about the embedded English interface", () => {
    expect(previewContent.zh_CN.representativeLabel).toContain("英文");
    expect(previewContent.zh_CN.overview.title).toMatch(/[\u3400-\u9fff]/u);
  });
});
