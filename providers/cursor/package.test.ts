import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../../domain/model";
import type { CollectionContext, CollectionResult } from "../types";
import type { CursorDashboardJson } from "./page-dashboard";
import { createCursorPackage } from "./package";

const instance: ProviderInstanceRecord = {
  id: "cursor:default",
  providerKind: "cursor",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: 1,
  history: [],
};

function services(interaction: "allowed" | "forbidden") {
  return {
    fetch: globalThis.fetch,
    now: 10,
    signal: new AbortController().signal,
    interaction,
  };
}

function successfulCollection(): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "cursor",
      source: "web-session",
      fetchedAt: 10,
      metrics: [],
    },
  };
}

type CursorCollect = (
  context: CollectionContext,
  dashboard: CursorDashboardJson,
) => Promise<CollectionResult>;

describe("Cursor provider package", () => {
  test("scheduled collection never looks for or injects into a Cursor page", async () => {
    const collect = vi.fn<CursorCollect>().mockResolvedValue(successfulCollection());
    const findDashboardJson = vi.fn();
    const providerPackage = createCursorPackage({ collect, findDashboardJson });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual(successfulCollection());

    expect(findDashboardJson).not.toHaveBeenCalled();
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ now: 10 }),
      {},
    );
  });

  test("interactive collection gives page JSON to the extension-context collector", async () => {
    const dashboard = {
      grok: { usagePercent: 25 },
      credits: { total_cents: 1_250, used_cents: 200 },
    };
    const collect = vi.fn<CursorCollect>().mockResolvedValue(successfulCollection());
    const providerPackage = createCursorPackage({
      collect,
      findDashboardJson: vi.fn().mockResolvedValue(dashboard),
    });

    await expect(
      providerPackage.collect(instance, services("allowed")),
    ).resolves.toEqual(successfulCollection());
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ now: 10 }),
      dashboard,
    );
  });

  test("interactive bridge failure preserves base collection", async () => {
    const collect = vi.fn<CursorCollect>().mockResolvedValue(successfulCollection());
    const providerPackage = createCursorPackage({
      collect,
      findDashboardJson: vi
        .fn()
        .mockRejectedValue(new Error("private page failure")),
    });

    const result = await providerPackage.collect(instance, services("allowed"));

    expect(result).toEqual(successfulCollection());
    expect(collect).toHaveBeenCalledWith(expect.any(Object), {});
    expect(JSON.stringify(result)).not.toContain("private page failure");
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
});
