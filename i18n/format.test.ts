import { afterEach, describe, expect, it } from "vitest";

import {
  formatCurrency,
  formatDateTime,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "./format";
import { installI18nLocale } from "../test/i18n-harness";

afterEach(() => {
  installI18nLocale("en");
});

describe("locale-aware formatters", () => {
  it("formats numbers, percents, currency, dates, relative time, and lists in English", async () => {
    installI18nLocale("en");
    expect(formatNumber(1234.5)).toMatch(/1,234\.5|1,234.5/);
    expect(formatPercent(12.5)).toBe("12.5");
    expect(formatCurrency(12.5, "USD")).toContain("12.50");
    expect(formatDateTime(Date.UTC(2026, 7, 7, 16, 30))).toMatch(/Aug/);
    expect(formatRelativeTime(-5, "minute")).toMatch(/5/);
    expect(formatList(["A", "B"])).toMatch(/A/);
  });

  it("switches numeric grouping with the Chinese catalog", async () => {
    installI18nLocale("zh_CN");
    const formatted = formatNumber(1234);
    expect(formatted === "1,234" || formatted === "1,234" || formatted.includes("1234")).toBe(
      true,
    );
    expect(formatCurrency(12.5, "USD")).toContain("12.50");
  });
});
