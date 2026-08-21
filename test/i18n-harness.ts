import {
  generateChromeMessages,
  parseMessagesText,
  type ParsedMessage,
} from "@wxt-dev/i18n/build";
import { vi } from "vitest";

import enSource from "../locales/en.yml?raw";
import zhSource from "../locales/zh_CN.yml?raw";

export type TestLocale = "en" | "zh_CN";

const sources: Record<TestLocale, string> = {
  en: enSource,
  zh_CN: zhSource,
};

const parsedCatalogs = new Map<TestLocale, ParsedMessage[]>();
const chromeCatalogs = new Map<
  TestLocale,
  Record<string, { message: string }>
>();

export function loadCatalog(locale: TestLocale): ParsedMessage[] {
  const cached = parsedCatalogs.get(locale);
  if (cached) return cached;
  const parsed = parseMessagesText(sources[locale], "YAML");
  parsedCatalogs.set(locale, parsed);
  chromeCatalogs.set(locale, generateChromeMessages(parsed));
  return parsed;
}

export function chromeMessages(
  locale: TestLocale,
): Record<string, { message: string }> {
  loadCatalog(locale);
  return chromeCatalogs.get(locale) ?? {};
}

export function installI18nLocale(locale: TestLocale): void {
  const messages = chromeMessages(locale);
  vi.spyOn(browser.i18n, "getMessage").mockImplementation((key: string) => {
    return messages[key]?.message ?? "";
  });
}
