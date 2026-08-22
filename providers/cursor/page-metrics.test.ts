import { describe, expect, test } from "vitest";

import type { UsageSnapshot } from "../../domain/model";
import type { CollectionResult } from "../types";
import {
  applyCursorPageMetrics,
  classifyCursorGrokStatus,
  cursorPageDescriptionToken,
} from "./page-metrics";

const NOW = 1_800_000_000_000;
const GROK_START = NOW - 3 * 24 * 60 * 60 * 1_000;
const GROK_RESET = NOW + 4 * 24 * 60 * 60 * 1_000;

const monthly = {
  type: "quota" as const,
  id: "cursor-models-monthly",
  label: "Cursor models",
  scope: "model" as const,
  usedRatio: 0.17,
};

const grok = {
  type: "quota" as const,
  id: "grok-bot-weekly",
  label: "Grok Bot",
  scope: "feature" as const,
  usedRatio: 0.92,
  observedAt: NOW - 20 * 60 * 1_000,
  cycle: {
    cadence: "rolling" as const,
    startedAt: GROK_START,
    resetsAt: GROK_RESET,
    durationMs: GROK_RESET - GROK_START,
  },
};

const credits = {
  type: "balance" as const,
  id: "extra-usage-credits",
  label: "Extra usage credits",
  scope: "product" as const,
  unit: "USD",
  value: 10.5,
  observedAt: NOW - 20 * 60 * 1_000,
};

function baseResult(): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "cursor",
      source: "web-session",
      fetchedAt: NOW,
      metrics: [monthly],
      usageGroups: [
        { id: "usage", label: "Usage", metricIds: ["cursor-models-monthly"] },
      ],
    },
  };
}

function previous(): UsageSnapshot {
  return {
    providerKind: "cursor",
    source: "web-session",
    fetchedAt: NOW - 20 * 60 * 1_000,
    metrics: [monthly, grok, credits],
  };
}

describe("Cursor page-metric carry-forward", () => {
  test("classifies observed Grok Bot payloads without inventing fields", () => {
    expect(classifyCursorGrokStatus(undefined)).toBe("absent");
    expect(classifyCursorGrokStatus({ hasAvailableUsage: "yes" })).toBe("mismatch");
    expect(
      classifyCursorGrokStatus({
        hasAvailableUsage: false,
        hasNonZeroIncludedLimit: true,
        usagePercent: 92,
        currentPeriodStart: "2030-04-01T00:00:00.000Z",
        nextResetTimestampUtc: "2030-04-08T00:00:00.000Z",
      }),
    ).toBe("unavailable");
    expect(
      classifyCursorGrokStatus({
        hasAvailableUsage: true,
        hasNonZeroIncludedLimit: true,
        usagePercent: 92,
        currentPeriodStart: "2030-04-01T00:00:00.000Z",
        nextResetTimestampUtc: "2030-04-08T00:00:00.000Z",
      }),
    ).toBe("ready");
  });

  test("carries last-good Grok Bot and extra credits across a scheduled refresh", () => {
    const result = applyCursorPageMetrics(
      baseResult(),
      previous(),
      { kind: "skipped" },
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        fetchedAt: NOW,
        metrics: expect.arrayContaining([
          monthly,
          expect.objectContaining({
            id: "grok-bot-weekly",
            usedRatio: 0.92,
            observedAt: NOW - 20 * 60 * 1_000,
          }),
          expect.objectContaining({
            id: "extra-usage-credits",
            value: 10.5,
            observedAt: NOW - 20 * 60 * 1_000,
          }),
        ]),
        usageGroups: [
          expect.objectContaining({
            description: "cursor:carried:scheduled",
          }),
        ],
      },
    });
  });

  test("expires a carried Grok Bot once resetsAt has passed", () => {
    const expired = {
      ...grok,
      cycle: { ...grok.cycle, resetsAt: NOW - 1 },
    };
    const result = applyCursorPageMetrics(
      baseResult(),
      {
        ...previous(),
        metrics: [monthly, expired, credits],
      },
      { kind: "skipped" },
      NOW,
    );

    expect(result.ok && result.snapshot.metrics.map((metric) => metric.id)).toEqual(
      ["cursor-models-monthly", "extra-usage-credits"],
    );
    expect(result).toMatchObject({
      snapshot: {
        usageGroups: [
          expect.objectContaining({ description: "cursor:carried:scheduled" }),
        ],
      },
    });
  });

  test.each([
    [
      "no cursor.com tab",
      { kind: "no_tab" as const },
      "cursor:no-tab",
      "cursor:carried:no-tab",
    ],
    [
      "injection failure",
      { kind: "injection_failed" as const },
      "cursor:injection",
      "cursor:carried:injection",
    ],
    [
      "HTTP failure",
      {
        kind: "read" as const,
        grok: { ok: false as const, status: 403 },
        credits: { ok: false as const },
        aggregated: { ok: false as const, status: 403 },
      },
      "cursor:http:403",
      "cursor:carried:http:403",
    ],
    [
      "network failure",
      {
        kind: "read" as const,
        grok: { ok: false as const },
        credits: { ok: false as const },
        aggregated: { ok: false as const },
      },
      "cursor:network",
      "cursor:carried:network",
    ],
    [
      "payload mismatch",
      {
        kind: "read" as const,
        grok: { ok: true as const, value: { hasAvailableUsage: "yes" } },
        credits: { ok: false as const },
        aggregated: { ok: false as const },
      },
      "cursor:mismatch",
      "cursor:carried:mismatch",
    ],
  ])("attributes %s when Grok Bot is missing or carried", (_name, probe, missing, carried) => {
    expect(
      applyCursorPageMetrics(baseResult(), undefined, probe, NOW),
    ).toMatchObject({
      snapshot: {
        usageGroups: [expect.objectContaining({ description: missing })],
      },
    });
    expect(
      applyCursorPageMetrics(baseResult(), previous(), probe, NOW),
    ).toMatchObject({
      snapshot: {
        usageGroups: [expect.objectContaining({ description: carried })],
      },
    });
  });

  test("does not carry Grok Bot when entitlement flags say it is unavailable", () => {
    const probe = {
      kind: "read" as const,
      grok: {
        ok: true as const,
        value: {
          hasAvailableUsage: false,
          hasNonZeroIncludedLimit: true,
          usagePercent: 92,
          currentPeriodStart: "2030-04-01T00:00:00.000Z",
          nextResetTimestampUtc: "2030-04-08T00:00:00.000Z",
        },
      },
      credits: { ok: false as const },
      aggregated: { ok: false as const },
    };

    const result = applyCursorPageMetrics(baseResult(), previous(), probe, NOW);
    expect(result.ok && result.snapshot.metrics.map((metric) => metric.id)).toEqual(
      ["cursor-models-monthly", "extra-usage-credits"],
    );
    expect(result).toMatchObject({
      snapshot: {
        usageGroups: [
          expect.objectContaining({ description: "cursor:unavailable" }),
        ],
      },
    });
  });

  test("keeps a fresh Grok Bot bar when aggregated usage is missing", () => {
    const freshGrok = {
      ...grok,
      observedAt: undefined,
      usedRatio: 0.92,
    };
    const result = applyCursorPageMetrics(
      {
        ok: true,
        snapshot: {
          providerKind: "cursor",
          source: "web-session",
          fetchedAt: NOW,
          metrics: [monthly, freshGrok],
        },
      },
      undefined,
      {
        kind: "read",
        grok: {
          ok: true,
          value: {
            hasAvailableUsage: true,
            hasNonZeroIncludedLimit: true,
            usagePercent: 92,
            currentPeriodStart: "2030-04-01T00:00:00.000Z",
            nextResetTimestampUtc: "2030-04-08T00:00:00.000Z",
          },
        },
        credits: { ok: false },
        aggregated: { ok: false },
      },
      NOW,
    );

    expect(result).toMatchObject({
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({
            id: "grok-bot-weekly",
            usedRatio: 0.92,
            observedAt: NOW,
          }),
        ]),
        detailTables: [
          expect.objectContaining({
            rows: [],
            description: "cursor-detail:network",
          }),
        ],
      },
    });
    if (result.ok) {
      expect(result.snapshot.usageGroups?.[0]?.description).toBeUndefined();
    }
  });

  test("stamps a fresh Grok Bot with this collection time", () => {
    const fresh = {
      ...grok,
      observedAt: undefined,
      usedRatio: 0.5,
    };
    const result = applyCursorPageMetrics(
      {
        ok: true,
        snapshot: {
          providerKind: "cursor",
          source: "web-session",
          fetchedAt: NOW,
          metrics: [monthly, fresh],
        },
      },
      {
        ...previous(),
        metrics: [monthly, grok],
      },
      {
        kind: "read",
        grok: {
          ok: true,
          value: {
            hasAvailableUsage: true,
            hasNonZeroIncludedLimit: true,
            usagePercent: 50,
            currentPeriodStart: "2030-04-01T00:00:00.000Z",
            nextResetTimestampUtc: "2030-04-08T00:00:00.000Z",
          },
        },
        credits: { ok: false },
        aggregated: { ok: false },
      },
      NOW,
    );

    expect(result).toMatchObject({
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({
            id: "grok-bot-weekly",
            usedRatio: 0.5,
            observedAt: NOW,
          }),
        ]),
      },
    });
    if (result.ok) {
      expect(result.snapshot.usageGroups?.[0]?.description).toBeUndefined();
    }
  });

  test("carries last-good included usage across a scheduled refresh", () => {
    const prior = {
      ...previous(),
      detailTables: [
        {
          id: "cursor-models",
          labelKey: "metrics.cursor.cursorModels",
          observedAt: NOW - 20 * 60 * 1_000,
          expiresAt: NOW + 1_000,
          columns: [
            { key: "model", labelKey: "metrics.detail.model", type: "text" as const },
            { key: "tokens", labelKey: "metrics.detail.tokens", type: "tokens" as const },
            { key: "percent", labelKey: "metrics.detail.percent", type: "percent" as const },
          ],
          rows: [
            { id: "composer", cells: { model: "composer-1.5", tokens: 9, percent: 3 } },
          ],
        },
      ],
    };
    const result = applyCursorPageMetrics(
      baseResult(),
      prior,
      { kind: "skipped" },
      NOW,
    );
    expect(result).toMatchObject({
      snapshot: {
        detailTables: [
          expect.objectContaining({
            id: "cursor-models",
            observedAt: NOW - 20 * 60 * 1_000,
            description: "cursor-detail:carried:scheduled",
            rows: [
              { id: "composer", cells: { model: "composer-1.5", tokens: 9, percent: 3 } },
            ],
          }),
        ],
      },
    });
  });

  test("expires included usage with the monthly cycle instead of showing a stale month", () => {
    const prior = {
      ...previous(),
      detailTables: [
        {
          id: "cursor-models",
          labelKey: "metrics.cursor.cursorModels",
          observedAt: NOW - 20 * 60 * 1_000,
          expiresAt: NOW - 1,
          columns: [
            { key: "model", labelKey: "metrics.detail.model", type: "text" as const },
            { key: "tokens", labelKey: "metrics.detail.tokens", type: "tokens" as const },
          ],
          rows: [{ id: "old", cells: { model: "old-model", tokens: 1 } }],
        },
      ],
    };
    const result = applyCursorPageMetrics(
      baseResult(),
      prior,
      { kind: "skipped" },
      NOW,
    );
    expect(result).toMatchObject({
      snapshot: {
        detailTables: [
          expect.objectContaining({
            id: "included-usage",
            rows: [],
            description: "cursor-detail:scheduled",
          }),
        ],
      },
    });
  });

  test("builds locale-neutral description tokens", () => {
    expect(cursorPageDescriptionToken(false, "no-tab")).toBe("cursor:no-tab");
    expect(cursorPageDescriptionToken(true, "http:403")).toBe(
      "cursor:carried:http:403",
    );
  });
});
