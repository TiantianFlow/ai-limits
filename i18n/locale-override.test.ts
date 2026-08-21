import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyLocaleOverride,
  ensureCatalog,
  getLocaleOverride,
  hydrateLocaleOverride,
  l10n,
  LOCALE_OVERRIDE_STORAGE_KEY,
  persistLocaleOverride,
  preloadLocaleCatalog,
  resetLocaleRuntime,
} from "./index";
import { chromeMessages, installI18nLocale } from "../test/i18n-harness";

afterEach(() => {
  installI18nLocale("en");
  resetLocaleRuntime();
  preloadLocaleCatalog("en", chromeMessages("en"));
  preloadLocaleCatalog("zh_CN", chromeMessages("zh_CN"));
});

describe("locale override resolver", () => {
  it("resolves a non-default catalog when an override is active", async () => {
    await applyLocaleOverride("zh_CN");
    expect(l10n.t("common.used")).toBe("已使用");
    expect(l10n.t("announcements.connected", { label: "ChatGPT" })).toBe(
      "已连接 ChatGPT。",
    );
    expect(l10n.localeTag()).toBe("zh-CN");
    expect(l10n.count("refresh.updatedProviders", 1)).toBe("已更新 1 个服务。");
  });

  it("falls back to Chrome-resolved copy when no override is set", async () => {
    installI18nLocale("en");
    expect(getLocaleOverride()).toBeUndefined();
    expect(l10n.t("common.used")).toBe("Used");
    expect(l10n.t("announcements.connected", { label: "ChatGPT" })).toBe(
      "Connected ChatGPT.",
    );
  });

  it("falls back to English when an override locale is missing a key", async () => {
    const chinese = { ...chromeMessages("zh_CN") };
    delete chinese.common_used;
    resetLocaleRuntime();
    preloadLocaleCatalog("en", chromeMessages("en"));
    preloadLocaleCatalog("zh_CN", chinese);
    await applyLocaleOverride("zh_CN");
    expect(l10n.t("common.used")).toBe("Used");
    expect(l10n.t("common.left")).toBe("剩余");
  });

  it("loads override messages from the bundled _locales catalog", async () => {
    resetLocaleRuntime();
    installI18nLocale("en");
    vi.spyOn(browser.runtime, "getURL").mockImplementation(
      (path: string) => `https://extension.test/${path}`,
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url: string | URL | Request) => {
        const href = String(url);
        const locale = href.includes("zh_CN") ? "zh_CN" : "en";
        return {
          ok: true,
          json: async () => chromeMessages(locale),
        } as Response;
      },
    );
    await ensureCatalog("zh_CN");
    await applyLocaleOverride("zh_CN");
    expect(l10n.t("common.used")).toBe("已使用");
    expect(browser.runtime.getURL).toHaveBeenCalledWith(
      "_locales/zh_CN/messages.json",
    );
    fetchSpy.mockRestore();
  });

  it("hydrates a stored override and Follow Chrome clears it", async () => {
    await persistLocaleOverride("zh_CN");
    resetLocaleRuntime();
    preloadLocaleCatalog("en", chromeMessages("en"));
    preloadLocaleCatalog("zh_CN", chromeMessages("zh_CN"));
    await expect(hydrateLocaleOverride()).resolves.toBe("zh_CN");
    expect(l10n.t("settings.title")).toBe("设置");

    await applyLocaleOverride(undefined);
    expect(getLocaleOverride()).toBeUndefined();
    expect(l10n.t("settings.title")).toBe("Settings");
    await expect(
      browser.storage.local.get(LOCALE_OVERRIDE_STORAGE_KEY),
    ).resolves.toEqual({});
  });
});
