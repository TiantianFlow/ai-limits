import { i18n } from "#i18n";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locales";

export type { SupportedLocale } from "./locales";
export {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
} from "./locales";

export type MessageKey = Parameters<typeof i18n.t>[0];
export type AnnouncementTone = "success" | "attention";
export type TextDirection = "ltr" | "rtl";
export type MessageCatalog = Record<string, { message: string }>;

type NamedParams = Record<string, string | number>;

export const LOCALE_OVERRIDE_STORAGE_KEY = "aiLimitsLocaleOverride";

const NAMED_SUBSTITUTION_RE = /\{([A-Za-z0-9_]+)\}/g;

const catalogs = new Map<SupportedLocale, MessageCatalog>();
let activeOverride: SupportedLocale | undefined;
let localeHydrated = false;

function chromeMessageKey(key: string): string {
  return key.replaceAll(".", "_");
}

function applyNamedSubstitutions(
  message: string,
  substitutions: NamedParams,
): string {
  return message.replace(NAMED_SUBSTITUTION_RE, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(substitutions, name)
      ? String(substitutions[name])
      : match,
  );
}

function lookupOverrideMessage(key: string): string {
  const chromeKey = chromeMessageKey(key);
  return (
    catalogs.get(activeOverride!)?.[chromeKey]?.message ??
    catalogs.get(DEFAULT_LOCALE)?.[chromeKey]?.message ??
    ""
  );
}

function translate(key: string, substitutions?: NamedParams): string {
  if (!activeOverride) {
    return substitutions
      ? i18n.t(key as MessageKey, substitutions as never)
      : i18n.t(key as MessageKey);
  }
  const message = lookupOverrideMessage(key);
  if (!message || !substitutions) {
    return message;
  }
  return applyNamedSubstitutions(message, substitutions);
}

export function preloadLocaleCatalog(
  locale: SupportedLocale,
  messages: MessageCatalog,
): void {
  catalogs.set(locale, messages);
}

export function resetLocaleRuntime(): void {
  catalogs.clear();
  activeOverride = undefined;
  localeHydrated = false;
}

export function isLocaleHydrated(): boolean {
  return localeHydrated;
}

export function getLocaleOverride(): SupportedLocale | undefined {
  return activeOverride;
}

export function localeDisplayName(locale: SupportedLocale): string {
  return catalogs.get(locale)?.meta_displayName?.message ?? locale;
}

export async function readLocaleOverride(): Promise<
  SupportedLocale | undefined
> {
  const stored = await browser.storage.local.get(LOCALE_OVERRIDE_STORAGE_KEY);
  const value = stored[LOCALE_OVERRIDE_STORAGE_KEY];
  return isSupportedLocale(value) ? value : undefined;
}

export async function persistLocaleOverride(
  locale: SupportedLocale | undefined,
): Promise<void> {
  if (locale === undefined) {
    await browser.storage.local.remove(LOCALE_OVERRIDE_STORAGE_KEY);
    return;
  }
  await browser.storage.local.set({ [LOCALE_OVERRIDE_STORAGE_KEY]: locale });
}

export async function ensureCatalog(locale: SupportedLocale): Promise<void> {
  if (catalogs.has(locale)) {
    return;
  }
  try {
    const url = (browser.runtime.getURL as (path: string) => string)(
      `_locales/${locale}/messages.json`,
    );
    const response = await fetch(url);
    if (!response.ok) {
      return;
    }
    catalogs.set(
      locale,
      (await response.json()) as MessageCatalog,
    );
  } catch {
    // Bundled catalogs are optional in tests; production builds always emit them.
  }
}

export async function hydrateLocaleOverride(): Promise<
  SupportedLocale | undefined
> {
  await Promise.all(SUPPORTED_LOCALES.map((locale) => ensureCatalog(locale)));
  try {
    activeOverride = await readLocaleOverride();
  } catch {
    activeOverride = undefined;
  }
  localeHydrated = true;
  return activeOverride;
}

export async function applyLocaleOverride(
  locale: SupportedLocale | undefined,
): Promise<void> {
  if (locale) {
    await ensureCatalog(locale);
    await ensureCatalog(DEFAULT_LOCALE);
  }
  await persistLocaleOverride(locale);
  activeOverride = locale;
}

export const l10n = {
  t: translate as typeof i18n.t,

  localeTag(): string {
    return translate("meta.localeTag");
  },

  direction(): TextDirection {
    return translate("meta.direction") === "rtl" ? "rtl" : "ltr";
  },

  count(baseKey: string, count: number, namedParams: NamedParams = {}): string {
    const tag = l10n.localeTag();
    const category = new Intl.PluralRules(tag).select(count);
    const formattedCount = new Intl.NumberFormat(tag).format(count);
    const params = { count: formattedCount, ...namedParams };
    const selected = translate(
      `${baseKey}.${category}` as MessageKey,
      params,
    );
    return selected || translate(`${baseKey}.other` as MessageKey, params);
  },
};

export function applyDocumentLocale(document: Document): void {
  document.documentElement.lang = l10n.localeTag();
  document.documentElement.dir = l10n.direction();
  document.title = l10n.t("manifest.name");
}
