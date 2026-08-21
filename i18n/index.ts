import { i18n } from "#i18n";

export type MessageKey = Parameters<typeof i18n.t>[0];
export type AnnouncementTone = "success" | "attention";
export type TextDirection = "ltr" | "rtl";

type NamedParams = Record<string, string | number>;

export const l10n = {
  t: i18n.t,

  localeTag(): string {
    return i18n.t("meta.localeTag");
  },

  direction(): TextDirection {
    return i18n.t("meta.direction") === "rtl" ? "rtl" : "ltr";
  },

  count(baseKey: string, count: number, namedParams: NamedParams = {}): string {
    const tag = l10n.localeTag();
    const category = new Intl.PluralRules(tag).select(count);
    const formattedCount = new Intl.NumberFormat(tag).format(count);
    const params = { count: formattedCount, ...namedParams };
    const selected = i18n.t(
      `${baseKey}.${category}` as MessageKey,
      params as never,
    );
    return (
      selected ||
      i18n.t(`${baseKey}.other` as MessageKey, params as never)
    );
  },
};

export function applyDocumentLocale(document: Document): void {
  document.documentElement.lang = l10n.localeTag();
  document.documentElement.dir = l10n.direction();
  document.title = l10n.t("manifest.name");
}
