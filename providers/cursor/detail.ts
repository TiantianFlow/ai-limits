import {
  DETAIL_TABLE_MAX_TABLES,
  DETAIL_TABLE_ROW_CAP,
  type DetailTable,
} from "../../domain/model";

// Shape observed live from POST /api/dashboard/get-aggregated-usage-events.
// cacheWriteTokens / cacheReadTokens / totalCacheWriteTokens /
// totalCacheReadTokens are on the wire and omitted from v1 — six data
// columns plus cache would not fit the side panel. They were not missed.

export const CURSOR_DETAIL_COLUMNS = [
  { key: "model", labelKey: "metrics.detail.model", type: "text" as const },
  { key: "input", labelKey: "metrics.detail.input", type: "tokens" as const },
  { key: "output", labelKey: "metrics.detail.output", type: "tokens" as const },
  { key: "cost", labelKey: "metrics.detail.cost", type: "money" as const },
] as const;

const KNOWN_TIERS = {
  2: { id: "cursor-models", labelKey: "metrics.cursor.cursorModels" },
  1: { id: "other-models", labelKey: "metrics.cursor.otherModels" },
} as const;

type ParsedRow = {
  id: string;
  model: string;
  input: number;
  output: number;
  costCents: number;
  tier: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNonNegativeNumberString(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^(?:\d+|\d+\.\d+)$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function parseModelIntent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= 128 ? name : undefined;
}

function parseRow(value: unknown): ParsedRow | undefined {
  if (!isRecord(value)) return undefined;
  const model = parseModelIntent(value.modelIntent);
  const input = parseNonNegativeNumberString(value.inputTokens);
  const output = parseNonNegativeNumberString(value.outputTokens);
  const costCents = parseNonNegativeNumber(value.totalCents);
  const tier = parseNonNegativeNumber(value.tier);
  if (
    model === undefined ||
    input === undefined ||
    output === undefined ||
    costCents === undefined ||
    tier === undefined ||
    !Number.isInteger(tier)
  ) {
    return undefined;
  }
  return { id: model, model, input, output, costCents, tier };
}

function centsToDollars(cents: number): number {
  return cents / 100;
}

function toCells(row: Pick<ParsedRow, "model" | "input" | "output" | "costCents">) {
  return {
    model: row.model,
    input: row.input,
    output: row.output,
    cost: centsToDollars(row.costCents),
  };
}

function capRows(rows: readonly ParsedRow[]): Pick<DetailTable, "rows" | "omittedRowCount"> {
  const ranked = [...rows].sort((left, right) => {
    if (right.costCents !== left.costCents) return right.costCents - left.costCents;
    return right.input + right.output - (left.input + left.output);
  });
  const omittedRowCount = Math.max(0, ranked.length - DETAIL_TABLE_ROW_CAP);
  return {
    rows: ranked.slice(0, DETAIL_TABLE_ROW_CAP).map((row) => ({
      id: row.id,
      cells: toCells(row),
    })),
    ...(omittedRowCount > 0 ? { omittedRowCount } : {}),
  };
}

function tableFromRows(
  id: string,
  labelKey: string,
  rows: readonly ParsedRow[],
  observedAt: number,
  expiresAt: number | undefined,
): DetailTable | undefined {
  if (rows.length === 0) return undefined;
  return {
    id,
    labelKey,
    columns: [...CURSOR_DETAIL_COLUMNS],
    ...capRows(rows),
    observedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function bucketForTier(tier: number): { id: string; labelKey: string } {
  return (
    KNOWN_TIERS[tier as keyof typeof KNOWN_TIERS] ?? {
      id: `tier-${tier}`,
      labelKey: "metrics.detail.unknownTier",
    }
  );
}

function totalsTable(
  value: Record<string, unknown>,
  observedAt: number,
  expiresAt: number | undefined,
): DetailTable | undefined {
  const input = parseNonNegativeNumberString(value.totalInputTokens);
  const output = parseNonNegativeNumberString(value.totalOutputTokens);
  const costCents = parseNonNegativeNumber(value.totalCostCents);
  if (input === undefined || output === undefined || costCents === undefined) {
    return undefined;
  }
  return {
    id: "included-usage-totals",
    labelKey: "metrics.detail.total",
    columns: [...CURSOR_DETAIL_COLUMNS],
    rows: [
      {
        id: "total",
        cells: {
          input,
          output,
          cost: centsToDollars(costCents),
        },
        badgeKey: "metrics.detail.total",
      },
    ],
    observedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export function parseCursorAggregatedUsage(
  value: unknown,
  observedAt: number,
  expiresAt?: number,
): DetailTable[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.aggregations)) return undefined;

  const grouped = new Map<number, ParsedRow[]>();
  for (const candidate of value.aggregations) {
    const row = parseRow(candidate);
    if (row === undefined) continue;
    const bucket = grouped.get(row.tier);
    if (bucket) bucket.push(row);
    else grouped.set(row.tier, [row]);
  }
  if (grouped.size === 0) return undefined;

  const orderedTiers = [
    ...[2, 1].filter((tier) => grouped.has(tier)),
    ...[...grouped.keys()].filter((tier) => tier !== 2 && tier !== 1).sort((left, right) => left - right),
  ];
  const modelTables = orderedTiers.flatMap((tier) => {
    const bucket = bucketForTier(tier);
    const table = tableFromRows(
      bucket.id,
      bucket.labelKey,
      grouped.get(tier) ?? [],
      observedAt,
      expiresAt,
    );
    return table === undefined ? [] : [table];
  });
  const totals = totalsTable(value, observedAt, expiresAt);
  const room = Math.max(0, DETAIL_TABLE_MAX_TABLES - (totals === undefined ? 0 : 1));
  return [
    ...modelTables.slice(0, room),
    ...(totals === undefined ? [] : [totals]),
  ];
}
