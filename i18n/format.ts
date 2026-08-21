import { l10n } from "./index";

const CURRENCY_UNIT = /^[A-Z]{3}$/;

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(l10n.localeTag(), options).format(value);
}

export function formatPercent(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 2 });
}

export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(l10n.localeTag(), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(l10n.localeTag(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
): string {
  return new Intl.RelativeTimeFormat(l10n.localeTag(), {
    numeric: "auto",
  }).format(value, unit);
}

export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(l10n.localeTag(), {
    style: "narrow",
    type: "conjunction",
  }).format(items);
}

export function isCurrencyUnit(unit: string): boolean {
  return CURRENCY_UNIT.test(unit);
}

export function formatAmount(value: number, unit: string): string {
  if (isCurrencyUnit(unit)) {
    return formatCurrency(value, unit);
  }
  return `${formatNumber(value)} ${localizeUnit(unit)}`;
}

export function localizeUnit(unit: string): string {
  switch (unit) {
    case "credits":
      return l10n.t("metrics.units.credits");
    case "voices":
      return l10n.t("metrics.units.voices");
    case "actions":
      return l10n.t("metrics.units.actions");
    case "quota units":
      return l10n.t("metrics.units.quotaUnits");
    default:
      return unit;
  }
}
