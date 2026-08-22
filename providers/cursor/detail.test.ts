import { describe, expect, test } from "vitest";

import { DETAIL_TABLE_ROW_CAP } from "../../domain/model";
import { parseCursorAggregatedUsage } from "./detail";

const NOW = 1_800_000_000_000;

describe("Cursor aggregated usage parser (inferred fixtures)", () => {
  test("splits named cursor/other buckets and caps the largest rows", () => {
    const rows = Array.from({ length: DETAIL_TABLE_ROW_CAP + 3 }, (_, index) => ({
      modelIntent: `cursor-model-${index}`,
      totalTokens: (index + 1) * 1_000,
      usagePercent: index,
    }));
    const tables = parseCursorAggregatedUsage(
      {
        cursorModels: rows,
        otherModels: [
          { modelName: "claude-4-sonnet", totalTokens: 50, usagePercent: 2 },
        ],
      },
      NOW,
      NOW + 1,
    );

    expect(tables).toHaveLength(2);
    expect(tables?.[0]).toMatchObject({
      id: "cursor-models",
      labelKey: "metrics.cursor.cursorModels",
      omittedRowCount: 3,
      observedAt: NOW,
      expiresAt: NOW + 1,
    });
    expect(tables?.[0]?.rows).toHaveLength(DETAIL_TABLE_ROW_CAP);
    expect(tables?.[0]?.rows[0]?.cells.model).toBe(
      `cursor-model-${DETAIL_TABLE_ROW_CAP + 2}`,
    );
    expect(tables?.[1]?.rows).toEqual([
      {
        id: "claude-4-sonnet:0",
        cells: { model: "claude-4-sonnet", tokens: 50, percent: 2 },
      },
    ]);
  });

  test("keeps a flat list as one included-usage table", () => {
    const tables = parseCursorAggregatedUsage(
      {
        aggregations: [
          { model: "composer-1.5", inputTokens: 10, outputTokens: 5, percent: 4 },
        ],
      },
      NOW,
    );

    expect(tables).toEqual([
      expect.objectContaining({
        id: "included-usage",
        labelKey: "metrics.detail.includedUsage",
        rows: [
          {
            id: "composer-1.5:0",
            cells: { model: "composer-1.5", tokens: 15, percent: 4 },
          },
        ],
      }),
    ]);
  });

  test("returns undefined instead of inventing rows when the payload does not match", () => {
    expect(parseCursorAggregatedUsage({ ok: true }, NOW)).toBeUndefined();
    expect(parseCursorAggregatedUsage({ aggregations: [{ tokens: 9 }] }, NOW))
      .toBeUndefined();
  });
});
