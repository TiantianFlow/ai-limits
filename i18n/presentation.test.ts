import { afterEach, describe, expect, it } from "vitest";

import type { QuotaMetric, UsageSnapshot } from "../domain/model";
import {
  formatDetailCell,
  localizeDetailDescription,
  localizeGroupDescription,
  localizeGroupLabel,
  localizeMetricLabel,
  localizePlanLabel,
  localizeProviderName,
  localizeSegmentLabel,
} from "./presentation";
import { installI18nLocale } from "../test/i18n-harness";

afterEach(() => {
  installI18nLocale("en");
});

const englishEraSnapshot = {
  providerKind: "chatgpt",
  source: "web-session",
  fetchedAt: Date.UTC(2026, 0, 1),
  planLabel: "plus",
  metrics: [
    {
      type: "quota",
      id: "five-hour",
      label: "5-hour messages",
      scope: "general",
      usedRatio: 0.4,
    },
    {
      type: "quota",
      id: "3-day",
      label: "3-day messages",
      scope: "general",
      usedRatio: 0.2,
    },
    {
      type: "balance",
      id: "credits",
      label: "Credits",
      scope: "product",
      unit: "credits",
      value: 12,
    },
  ],
  usageGroups: [
    {
      id: "usage",
      label: "Usage",
      metricIds: ["five-hour", "3-day", "credits"],
    },
  ],
} satisfies UsageSnapshot;

const grokDiagnosticSnapshot = {
  providerKind: "grok",
  source: "web-session",
  fetchedAt: Date.UTC(2026, 0, 1),
  metrics: [
    {
      type: "quota",
      id: "2-hour-fast-queries",
      label: "2-hour fast queries",
      scope: "general",
      usedRatio: 0.1,
    } satisfies QuotaMetric,
  ],
  usageGroups: [
    {
      id: "rate-limits",
      label: "Chat rate limits",
      description:
        "Grok usage-pool grpc-status=5. message=internal GetGrokCreditsConfig HTTP 200 content-type=application/grpc-web+proto",
      metricIds: ["2-hour-fast-queries"],
    },
  ],
} satisfies UsageSnapshot;

describe("locale-neutral presentation", () => {
  it("re-renders an English-era stored snapshot in Chinese without a refresh", async () => {
    installI18nLocale("zh_CN");
    expect(localizeProviderName("chatgpt")).toBe("ChatGPT");
    expect(localizePlanLabel("chatgpt", englishEraSnapshot.planLabel)).toBe(
      "Plus",
    );
    expect(
      localizeMetricLabel("chatgpt", englishEraSnapshot.metrics[0]!),
    ).toBe("5 小时消息");
    expect(
      localizeMetricLabel("chatgpt", englishEraSnapshot.metrics[1]!),
    ).toBe("3 天消息");
    expect(
      localizeMetricLabel("chatgpt", englishEraSnapshot.metrics[2]!),
    ).toBe("额度");
    expect(
      localizeGroupLabel("chatgpt", englishEraSnapshot.usageGroups![0]!),
    ).toBe("用量");
  });

  it("localizes Cursor page-metric tokens and never shows the raw token", async () => {
    installI18nLocale("en");
    expect(
      localizeGroupDescription("cursor", {
        id: "usage",
        description: "cursor:no-tab",
      }),
    ).toBe("Open cursor.com, then Refresh, to update Grok Bot.");
    expect(
      localizeGroupDescription("cursor", {
        id: "usage",
        description: "cursor:permission",
      }),
    ).toBe("Cursor page access is missing. Reconnect Cursor to update Grok Bot.");
    expect(
      localizeGroupDescription("cursor", {
        id: "usage",
        description: "cursor:carried:http:403",
      }),
    ).toBe(
      "Some Cursor page values are from an earlier refresh. Grok Bot could not be refreshed (HTTP 403).",
    );
    expect(
      localizeGroupDescription("cursor", {
        id: "usage",
        description: "cursor:unavailable",
      }),
    ).toBe("Grok Bot is not available on this account.");
    expect(
      localizeGroupDescription("cursor", {
        id: "usage",
        description: "not-a-cursor-token",
      }),
    ).toBeUndefined();
    installI18nLocale("zh_CN");
    expect(
      localizeGroupDescription("cursor", {
        id: "usage",
        description: "cursor:no-tab",
      }),
    ).toBe("请打开 cursor.com，然后点击刷新，以更新 Grok Bot。");
  });

  it("formats detail cells by declared type", () => {
    expect(formatDetailCell("text", "composer-1.5")).toBe("composer-1.5");
    expect(formatDetailCell("tokens", 12000)).toBe("12,000");
    expect(formatDetailCell("percent", 40)).toBe("40%");
    expect(formatDetailCell("money", 1.5)).toBe("$1.50");
  });

  it("localizes included-usage tokens without showing the raw token", () => {
    expect(localizeDetailDescription("cursor-detail:mismatch")).toBe(
      "Cursor's included-usage response could not be read.",
    );
    expect(localizeDetailDescription("cursor-detail:carried:http:403")).toBe(
      "Included usage is from an earlier page refresh. Included usage could not be refreshed (HTTP 403).",
    );
    expect(localizeDetailDescription("cursor:no-tab")).toBeUndefined();
  });

  it("never renders raw Grok diagnostics as visible copy", async () => {
    installI18nLocale("en");
    const description = localizeGroupDescription(
      "grok",
      grokDiagnosticSnapshot.usageGroups[0]!,
    );
    expect(description).toBe("Usage-pool details are unavailable");
    expect(description).not.toMatch(/grpc|HTTP|content-type|protobuf/i);
    installI18nLocale("zh_CN");
    expect(
      localizeGroupDescription("grok", grokDiagnosticSnapshot.usageGroups[0]!),
    ).toBe("用量池详情不可用");
  });

  it("keeps unknown provider/user labels opaque", async () => {
    installI18nLocale("zh_CN");
    expect(localizePlanLabel("newapi", "Team relay gold")).toBe(
      "Team relay gold",
    );
    expect(
      localizeMetricLabel("claude", {
        id: "weekly-scoped-sonnet-4",
        label: "Weekly Sonnet 4",
      }),
    ).toBe("每周 Sonnet 4");
    expect(
      localizeSegmentLabel("kimi", { id: "work", label: "Work" }),
    ).toBe("Kimi");
  });
});
