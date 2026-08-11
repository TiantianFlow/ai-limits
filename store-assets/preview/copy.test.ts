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
    expect(previewContent.zh_CN.history.title).toMatch(/[\u3400-\u9fff]/u);
  });

  it("gives local quota history a dedicated store-artwork view", () => {
    expect(previewContent.en.history.title).toMatch(/history/i);
    expect(previewContent.en.history.description).toMatch(/local/i);
    expect(previewContent.en.history.description).toMatch(/refresh/i);
  });

  it("keeps promotional descriptions concise at half-size", () => {
    expect(previewContent.en.promo.description.length).toBeLessThanOrEqual(60);
    expect([...previewContent.zh_CN.promo.description].length).toBeLessThanOrEqual(
      24,
    );
  });
});
