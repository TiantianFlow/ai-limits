import { describe, expect, test } from "vitest";

import { DETAIL_TABLE_ROW_CAP } from "../../domain/model";
import { parseCursorAggregatedUsage } from "./detail";

const NOW = 1_800_000_000_000;

// Shape observed live from POST /api/dashboard/get-aggregated-usage-events.
// Values below are synthetic.
function observedEnvelope(
  aggregations: readonly Record<string, unknown>[],
  totals: {
    totalInputTokens?: unknown;
    totalOutputTokens?: unknown;
    totalCostCents?: unknown;
  } = {
    totalInputTokens: "150",
    totalOutputTokens: "30",
    totalCostCents: 110,
  },
) {
  return {
    aggregations,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalCacheWriteTokens: "1",
    totalCacheReadTokens: "2",
    totalCostCents: totals.totalCostCents,
  };
}

function observedRow(
  modelIntent: string,
  tier: number,
  inputTokens: unknown,
  outputTokens: unknown,
  totalCents: unknown,
): Record<string, unknown> {
  return {
    modelIntent,
    inputTokens,
    outputTokens,
    cacheWriteTokens: "0",
    cacheReadTokens: "0",
    totalCents,
    tier,
  };
}

describe("Cursor aggregated usage parser (observed shape, synthetic values)", () => {
  test("splits numeric tiers, parses string token fields, and uses provider totals", () => {
    const tables = parseCursorAggregatedUsage(
      observedEnvelope([
        observedRow("composer-2.5", 2, "100", "20", 30),
        observedRow("cursor-grok-4.6-high", 2, "40", "10", 10),
        observedRow("sand-default", 1, "50", "10", 80),
      ]),
      NOW,
      NOW + 1,
    );

    expect(tables?.map((table) => table.id)).toEqual([
      "cursor-models",
      "other-models",
      "included-usage-totals",
    ]);
    expect(tables?.[0]).toMatchObject({
      labelKey: "metrics.cursor.cursorModels",
      columns: [
        { key: "model", type: "text" },
        { key: "input", type: "tokens" },
        { key: "output", type: "tokens" },
        { key: "cost", type: "money" },
      ],
      rows: [
        {
          id: "composer-2.5",
          cells: { model: "composer-2.5", input: 100, output: 20, cost: 0.3 },
        },
        {
          id: "cursor-grok-4.6-high",
          cells: {
            model: "cursor-grok-4.6-high",
            input: 40,
            output: 10,
            cost: 0.1,
          },
        },
      ],
    });
    expect(tables?.[1]?.rows[0]?.cells).toEqual({
      model: "sand-default",
      input: 50,
      output: 10,
      cost: 0.8,
    });
    expect(tables?.[2]?.rows[0]).toEqual({
      id: "total",
      badgeKey: "metrics.detail.total",
      cells: { input: 150, output: 30, cost: 1.1 },
    });
    expect(JSON.stringify(tables)).not.toContain("percent");
  });

  test("rejects a row when a token field is not a parseable non-negative number string", () => {
    const tables = parseCursorAggregatedUsage(
      observedEnvelope([
        observedRow("composer-2.5", 2, "100", "20", 30),
        observedRow("bad-concat", 2, "10", "oops", 4),
        observedRow("numeric-not-string", 2, 10, 20, 4),
      ]),
      NOW,
    );

    expect(tables?.[0]?.rows.map((row) => row.id)).toEqual(["composer-2.5"]);
  });

  test("keeps an unknown tier in its own group instead of folding it into Cursor or Other", () => {
    const tables = parseCursorAggregatedUsage(
      observedEnvelope([
        observedRow("composer-2.5", 2, "10", "2", 5),
        observedRow("mystery-model", 9, "8", "1", 7),
      ]),
      NOW,
    );

    expect(tables?.map((table) => table.id)).toEqual([
      "cursor-models",
      "tier-9",
      "included-usage-totals",
    ]);
    expect(tables?.[1]).toMatchObject({
      id: "tier-9",
      labelKey: "metrics.detail.unknownTier",
      rows: [
        {
          id: "mystery-model",
          cells: { model: "mystery-model", input: 8, output: 1, cost: 0.07 },
        },
      ],
    });
  });

  test("caps each tier independently and does not invent a total by summing visible rows", () => {
    const many = Array.from({ length: DETAIL_TABLE_ROW_CAP + 4 }, (_, index) =>
      observedRow(`cursor-model-${index}`, 2, String((index + 1) * 10), "1", index + 1),
    );
    const tables = parseCursorAggregatedUsage(
      observedEnvelope(many, {
        totalInputTokens: "9999",
        totalOutputTokens: "88",
        totalCostCents: 321,
      }),
      NOW,
    );

    const cursorModels = tables?.find((table) => table.id === "cursor-models");
    const totals = tables?.find((table) => table.id === "included-usage-totals");
    expect(cursorModels?.rows).toHaveLength(DETAIL_TABLE_ROW_CAP);
    expect(cursorModels?.omittedRowCount).toBe(4);
    expect(totals?.rows[0]?.cells).toEqual({
      input: 9999,
      output: 88,
      cost: 3.21,
    });
    const visibleCost = cursorModels?.rows.reduce(
      (sum, row) => sum + Number(row.cells.cost),
      0,
    );
    expect(visibleCost).not.toBe(3.21);
  });

  test("returns undefined instead of inventing rows when the envelope does not match", () => {
    expect(parseCursorAggregatedUsage({ aggregations: [] }, NOW)).toBeUndefined();
    expect(
      parseCursorAggregatedUsage(
        { aggregations: [observedRow("only-name", 2, "x", "1", 1)] },
        NOW,
      ),
    ).toBeUndefined();
    expect(parseCursorAggregatedUsage([{ modelIntent: "composer-2.5" }], NOW))
      .toBeUndefined();
  });
});
