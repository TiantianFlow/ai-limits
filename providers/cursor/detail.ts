import {
  DETAIL_TABLE_ROW_CAP,
  type DetailTable,
} from "../../domain/model";

// INFERRED from the billing-page UI (model / Tokens / Usage(%)), not from a
// captured get-aggregated-usage-events body. Unknown keys are ignored.
// A mismatch returns undefined rather than inventing rows.

export const CURSOR_DETAIL_COLUMNS = [
  { key: "model", labelKey: "metrics.detail.model", type: "text" as const },
  { key: "tokens", labelKey: "metrics.detail.tokens", type: "tokens" as const },
  { key: "percent", labelKey: "metrics.detail.percent", type: "percent" as const },
] as const;

const CURSOR_BUCKET = {
  id: "cursor-models",
  labelKey: "metrics.cursor.cursorModels",
  keys: new Set([
    "cursormodels",
    "cursor-models",
    "auto",
    "automodels",
    "includedcursor",
  ]),
} as const;

const OTHER_BUCKET = {
  id: "other-models",
  labelKey: "metrics.cursor.otherModels",
  keys: new Set([
    "othermodels",
    "other-models",
    "api",
    "apimodels",
    "includedapi",
  ]),
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= 128 ? name : undefined;
}

function rowName(row: Record<string, unknown>): string | undefined {
  return (
    asName(row.modelIntent) ??
    asName(row.modelName) ??
    asName(row.model) ??
    asName(row.name) ??
    asName(row.label)
  );
}

function rowTokens(row: Record<string, unknown>): number | undefined {
  const total = asFiniteNumber(row.totalTokens) ?? asFiniteNumber(row.tokens);
  if (total !== undefined && total >= 0) return total;
  const input = asFiniteNumber(row.inputTokens);
  const output = asFiniteNumber(row.outputTokens);
  if (input !== undefined && output !== undefined && input >= 0 && output >= 0) {
    return input + output;
  }
  return undefined;
}

function rowPercent(row: Record<string, unknown>): number | undefined {
  const percent =
    asFiniteNumber(row.usagePercent) ??
    asFiniteNumber(row.percentUsed) ??
    asFiniteNumber(row.percent);
  return percent !== undefined && percent >= 0 && percent <= 100
    ? percent
    : undefined;
}

function parseRow(
  value: unknown,
  index: number,
): { id: string; name: string; tokens?: number; percent?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const name = rowName(value);
  if (name === undefined) return undefined;
  const tokens = rowTokens(value);
  const percent = rowPercent(value);
  if (tokens === undefined && percent === undefined) return undefined;
  return {
    id: asName(value.id) ?? `${name}:${index}`,
    name,
    ...(tokens === undefined ? {} : { tokens }),
    ...(percent === undefined ? {} : { percent }),
  };
}

function capRows(
  rows: readonly {
    id: string;
    name: string;
    tokens?: number;
    percent?: number;
  }[],
): Pick<DetailTable, "rows" | "omittedRowCount"> {
  const ranked = [...rows].sort((left, right) => {
    const leftMagnitude = left.tokens ?? left.percent ?? 0;
    const rightMagnitude = right.tokens ?? right.percent ?? 0;
    return rightMagnitude - leftMagnitude;
  });
  const omittedRowCount = Math.max(0, ranked.length - DETAIL_TABLE_ROW_CAP);
  return {
    rows: ranked.slice(0, DETAIL_TABLE_ROW_CAP).map((row) => ({
      id: row.id,
      cells: {
        model: row.name,
        ...(row.tokens === undefined ? {} : { tokens: row.tokens }),
        ...(row.percent === undefined ? {} : { percent: row.percent }),
      },
    })),
    ...(omittedRowCount > 0 ? { omittedRowCount } : {}),
  };
}

function tableFromRows(
  id: string,
  labelKey: string,
  rows: readonly {
    id: string;
    name: string;
    tokens?: number;
    percent?: number;
  }[],
  observedAt: number,
  expiresAt: number | undefined,
): DetailTable | undefined {
  if (rows.length === 0) return undefined;
  const capped = capRows(rows);
  return {
    id,
    labelKey,
    columns: [...CURSOR_DETAIL_COLUMNS],
    ...capped,
    observedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function arraysFromObject(
  value: Record<string, unknown>,
): { key: string; rows: unknown[] }[] {
  return Object.entries(value).flatMap(([key, candidate]) =>
    Array.isArray(candidate) ? [{ key, rows: candidate }] : [],
  );
}

function bucketForKey(key: string): typeof CURSOR_BUCKET | typeof OTHER_BUCKET | undefined {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  if (CURSOR_BUCKET.keys.has(normalized) || CURSOR_BUCKET.keys.has(key)) {
    return CURSOR_BUCKET;
  }
  if (OTHER_BUCKET.keys.has(normalized) || OTHER_BUCKET.keys.has(key)) {
    return OTHER_BUCKET;
  }
  return undefined;
}

function parseRowList(
  values: readonly unknown[],
): { id: string; name: string; tokens?: number; percent?: number }[] {
  return values.flatMap((value, index) => {
    const row = parseRow(value, index);
    return row === undefined ? [] : [row];
  });
}

export function parseCursorAggregatedUsage(
  value: unknown,
  observedAt: number,
  expiresAt?: number,
): DetailTable[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const table = tableFromRows(
      "included-usage",
      "metrics.detail.includedUsage",
      parseRowList(value),
      observedAt,
      expiresAt,
    );
    return table === undefined ? undefined : [table];
  }
  if (!isRecord(value)) return undefined;

  const nestedArrays = arraysFromObject(value);
  if (nestedArrays.length === 0 && isRecord(value.data)) {
    return parseCursorAggregatedUsage(value.data, observedAt, expiresAt);
  }

  const bucketed = new Map<string, {
    labelKey: string;
    rows: { id: string; name: string; tokens?: number; percent?: number }[];
  }>();
  const leftovers: { id: string; name: string; tokens?: number; percent?: number }[] = [];

  for (const group of nestedArrays) {
    const rows = parseRowList(group.rows);
    if (rows.length === 0) continue;
    const bucket = bucketForKey(group.key);
    if (bucket === undefined) {
      leftovers.push(...rows);
      continue;
    }
    const existing = bucketed.get(bucket.id);
    if (existing) {
      existing.rows.push(...rows);
    } else {
      bucketed.set(bucket.id, { labelKey: bucket.labelKey, rows: [...rows] });
    }
  }

  const tables = [
    ...[CURSOR_BUCKET, OTHER_BUCKET].flatMap((bucket) => {
      const grouped = bucketed.get(bucket.id);
      if (grouped === undefined) return [];
      const table = tableFromRows(
        bucket.id,
        grouped.labelKey,
        grouped.rows,
        observedAt,
        expiresAt,
      );
      return table === undefined ? [] : [table];
    }),
  ];

  if (tables.length > 0) {
    if (leftovers.length > 0) {
      const extra = tableFromRows(
        "included-usage",
        "metrics.detail.includedUsage",
        leftovers,
        observedAt,
        expiresAt,
      );
      return extra === undefined ? tables : [...tables, extra];
    }
    return tables;
  }

  const fallback = tableFromRows(
    "included-usage",
    "metrics.detail.includedUsage",
    leftovers.length > 0
      ? leftovers
      : parseRowList(
          nestedArrays.flatMap((group) => group.rows),
        ),
    observedAt,
    expiresAt,
  );
  return fallback === undefined ? undefined : [fallback];
}
