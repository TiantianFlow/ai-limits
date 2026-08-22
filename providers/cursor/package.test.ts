import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord, UsageSnapshot } from "../../domain/model";
import type { CollectionContext, CollectionResult } from "../types";
import type { CursorDashboardJson, CursorDashboardProbe } from "./page-dashboard";
import { createCursorPackage } from "./package";

const NOW = 1_800_000_000_000;
const GROK_START = NOW - 3 * 24 * 60 * 60 * 1_000;
const GROK_RESET = NOW + 4 * 24 * 60 * 60 * 1_000;

const instance: ProviderInstanceRecord = {
  id: "cursor:default",
  providerKind: "cursor",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: 1,
  history: [],
};

function services(interaction: "allowed" | "forbidden", now = NOW) {
  return {
    fetch: globalThis.fetch,
    now,
    signal: new AbortController().signal,
    interaction,
  };
}

const monthlyMetric = {
  type: "quota" as const,
  id: "cursor-models-monthly",
  label: "Cursor models",
  scope: "model" as const,
  usedRatio: 0.17,
};

const grokMetric = {
  type: "quota" as const,
  id: "grok-bot-weekly",
  label: "Grok Bot",
  scope: "feature" as const,
  usedRatio: 0.92,
  observedAt: NOW - 15 * 60 * 1_000,
  cycle: {
    cadence: "rolling" as const,
    startedAt: GROK_START,
    resetsAt: GROK_RESET,
    durationMs: GROK_RESET - GROK_START,
  },
};

function baseCollection(fetchedAt = NOW): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "cursor",
      source: "web-session",
      fetchedAt,
      metrics: [monthlyMetric],
      usageGroups: [
        {
          id: "usage",
          label: "Usage",
          metricIds: ["cursor-models-monthly"],
        },
      ],
    },
  };
}

function previousSnapshot(): UsageSnapshot {
  return {
    providerKind: "cursor",
    source: "web-session",
    fetchedAt: NOW - 15 * 60 * 1_000,
    metrics: [monthlyMetric, grokMetric],
    usageGroups: [
      {
        id: "usage",
        label: "Usage",
        metricIds: ["cursor-models-monthly", "grok-bot-weekly"],
      },
    ],
  };
}

type CursorCollect = (
  context: CollectionContext,
  dashboard: CursorDashboardJson,
) => Promise<CollectionResult>;

describe("Cursor provider package", () => {
  test("startup cleanup failure does not block package registration", async () => {
    const collect = vi.fn<CursorCollect>();
    const findDashboardJson = vi.fn();
    const providerPackage = createCursorPackage({
      collect,
      findDashboardJson,
      cleanupAbandonedOwnedTab: vi
        .fn()
        .mockRejectedValue(new Error("cleanup-private")),
    });

    await expect(providerPackage.startup?.()).resolves.toBeUndefined();
    expect(findDashboardJson).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  test("scheduled collection never looks for or injects into a Cursor page", async () => {
    const collect = vi.fn<CursorCollect>().mockResolvedValue(baseCollection());
    const findDashboardJson = vi.fn();
    const providerPackage = createCursorPackage({ collect, findDashboardJson });

    const result = await providerPackage.collect(instance, services("forbidden"));

    expect(findDashboardJson).not.toHaveBeenCalled();
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ now: NOW }),
      {},
    );
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [monthlyMetric],
        usageGroups: [
          {
            id: "usage",
            description: "cursor:scheduled",
            metricIds: ["cursor-models-monthly"],
          },
        ],
      },
    });
  });

  test("interactive collection gives page JSON to the extension-context collector", async () => {
    const dashboard = {
      grok: { usagePercent: 25 },
      credits: { total_cents: 1_250, used_cents: 200 },
    };
    const probe: CursorDashboardProbe = {
      kind: "read",
      grok: { ok: true, value: dashboard.grok },
      credits: { ok: true, value: dashboard.credits },
      aggregated: { ok: false },
    };
    const collect = vi.fn<CursorCollect>().mockResolvedValue(baseCollection());
    const providerPackage = createCursorPackage({
      collect,
      findDashboardJson: vi.fn().mockResolvedValue(probe),
    });

    await providerPackage.collect(instance, services("allowed"));
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ now: NOW }),
      dashboard,
    );
  });

  test("interactive bridge failure preserves base collection", async () => {
    const collect = vi.fn<CursorCollect>().mockResolvedValue(baseCollection());
    const providerPackage = createCursorPackage({
      collect,
      findDashboardJson: vi
        .fn()
        .mockRejectedValue(new Error("private page failure")),
    });

    const result = await providerPackage.collect(instance, services("allowed"));

    expect(collect).toHaveBeenCalledWith(expect.any(Object), {});
    expect(JSON.stringify(result)).not.toContain("private page failure");
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        usageGroups: [
          expect.objectContaining({
            description: "cursor:inject-threw:findDashboardJson threw",
          }),
        ],
      },
    });
  });

  test("rejects a mismatched provider instance without inspecting a page", async () => {
    const collect = vi.fn<CursorCollect>();
    const findDashboardJson = vi.fn();
    const providerPackage = createCursorPackage({ collect, findDashboardJson });

    await expect(
      providerPackage.collect(
        { ...instance, providerKind: "chatgpt", id: "chatgpt:default" },
        services("allowed"),
      ),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(findDashboardJson).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  test("scheduled collection carries last-good Grok Bot without injecting", async () => {
    const collect = vi.fn<CursorCollect>().mockResolvedValue(baseCollection());
    const findDashboardJson = vi.fn();
    const providerPackage = createCursorPackage({ collect, findDashboardJson });

    const result = await providerPackage.collect(
      { ...instance, snapshot: previousSnapshot() },
      services("forbidden"),
    );

    expect(findDashboardJson).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        fetchedAt: NOW,
        metrics: expect.arrayContaining([
          monthlyMetric,
          expect.objectContaining({
            id: "grok-bot-weekly",
            usedRatio: 0.92,
            observedAt: NOW - 15 * 60 * 1_000,
          }),
        ]),
        usageGroups: [
          expect.objectContaining({
            description: "cursor:carried:scheduled",
            metricIds: expect.arrayContaining([
              "cursor-models-monthly",
              "grok-bot-weekly",
            ]),
          }),
        ],
      },
    });
  });
});
