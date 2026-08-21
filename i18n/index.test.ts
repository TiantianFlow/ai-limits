import { afterEach, describe, expect, it } from "vitest";

import { applyDocumentLocale, l10n } from "./index";
import { installI18nLocale } from "../test/i18n-harness";

afterEach(() => {
  installI18nLocale("en");
});

describe("l10n facade", () => {
  it("looks up English copy and interpolates named placeholders", async () => {
    installI18nLocale("en");
    expect(l10n.t("common.used")).toBe("Used");
    expect(l10n.t("announcements.connected", { label: "ChatGPT" })).toBe(
      "Connected ChatGPT.",
    );
    expect(l10n.localeTag()).toBe("en");
    expect(l10n.direction()).toBe("ltr");
  });

  it("looks up Chinese copy for the same keys", async () => {
    installI18nLocale("zh_CN");
    expect(l10n.t("common.used")).toBe("已用");
    expect(l10n.t("common.left")).toBe("剩余");
    expect(l10n.localeTag()).toBe("zh-CN");
    expect(l10n.t("announcements.connected", { label: "ChatGPT" })).toBe(
      "已连接 ChatGPT。",
    );
  });

  it("selects every CLDR plural category and falls back to other", async () => {
    installI18nLocale("en");
    expect(l10n.count("refresh.updatedProviders", 0)).toBe("Updated 0 providers.");
    expect(l10n.count("refresh.updatedProviders", 1)).toBe("Updated 1 provider.");
    expect(l10n.count("refresh.updatedProviders", 2)).toBe("Updated 2 providers.");
    const arabic = new Intl.PluralRules("ar");
    expect(["zero", "one", "two", "few", "many", "other"]).toContain(
      arabic.select(3),
    );
    expect(l10n.count("header.providerCount", 3)).toContain("provider");
  });

  it("returns an empty string when a key is missing", async () => {
    installI18nLocale("en");
    expect(l10n.t("does.not.exist" as never)).toBe("");
  });

  it("applies html lang, dir, and title from the catalog", async () => {
    installI18nLocale("zh_CN");
    const document = new DOMParser().parseFromString(
      "<html lang='en'><head><title>x</title></head><body></body></html>",
      "text/html",
    );
    applyDocumentLocale(document);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.title).toBe("AI Limits");
  });
});
