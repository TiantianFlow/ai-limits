import type { QuotaMetric } from "../../domain/model";
import {
  PRODUCT_GROK_BUILD,
  PRODUCT_GROK_CHAT,
  type DecodedCreditsConfig,
  type DecodedProductUsage,
} from "./credits-config";

// Same tolerance Kimi monthlySegments and state-codec normalizeSegments use.
const SEGMENT_SUM_TOLERANCE = 1e-6;

const PRODUCT_SEGMENTS: Record<
  number,
  { id: "grok-build" | "chat"; label: string; order: number }
> = {
  [PRODUCT_GROK_BUILD]: { id: "grok-build", label: "Grok Build", order: 0 },
  [PRODUCT_GROK_CHAT]: { id: "chat", label: "Chat", order: 1 },
};

export type UsagePoolInspection =
  | { kind: "metric"; metric: QuotaMetric }
  | { kind: "absent"; reason: "disabled" | "empty" | "flag_missing" }
  | { kind: "unparseable"; message: string };

/**
 * Maps grok.com usage-pool / credits-config payloads to a calendar quota.
 * Accepts snake_case or lowerCamelCase. Does not invent used/limit counts.
 */
export function inspectUsagePool(value: unknown): UsagePoolInspection {
  if (value === undefined || value === null) {
    return { kind: "absent", reason: "empty" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      kind: "unparseable",
      message: "Grok usage-pool JSON is not an object.",
    };
  }

  const envelope = value as Record<string, unknown>;
  const config = unwrapPoolConfig(envelope);
  const billingFlag = unifiedBillingFlag(envelope, config);
  if (billingFlag === "false") {
    return { kind: "absent", reason: "disabled" };
  }
  if (config === undefined) {
    return {
      kind: "absent",
      reason: billingFlag === "absent" ? "flag_missing" : "empty",
    };
  }

  const hasPercent =
    "creditUsagePercent" in config || "credit_usage_percent" in config;
  const hasPeriod = "currentPeriod" in config || "current_period" in config;
  if (!hasPercent && !hasPeriod) {
    return {
      kind: "absent",
      reason: billingFlag === "absent" ? "flag_missing" : "empty",
    };
  }

  // proto3 omits credit_usage_percent at 0%. A valid current_period without
  // a percent is still a usable zero-usage window.
  const percent = hasPercent
    ? pickNumber(config, "creditUsagePercent", "credit_usage_percent")
    : 0;
  if (percent === undefined) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has non-finite field: credit_usage_percent",
    };
  }
  if (percent < 0 || percent > 100) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has out-of-range field: credit_usage_percent",
    };
  }

  if (!hasPeriod) {
    return {
      kind: "unparseable",
      message: "Grok usage-pool JSON missing required field: current_period",
    };
  }
  const period = pickRecord(config, "currentPeriod", "current_period");
  if (period === undefined) {
    return {
      kind: "unparseable",
      message: "Grok usage-pool JSON has invalid field: current_period",
    };
  }

  if (!("type" in period)) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool JSON missing required field: current_period.type",
    };
  }
  const window = periodWindow(period);
  if (window === undefined) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool JSON has unrecognized field: current_period.type",
    };
  }

  if (!("end" in period)) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool JSON missing required field: current_period.end",
    };
  }
  const end = parseTimestamp(period.end);
  if (end === undefined) {
    return {
      kind: "unparseable",
      message: "Grok usage-pool JSON has invalid field: current_period.end",
    };
  }

  const start = parseTimestamp(pick(period, "start"));
  const bounded = start !== undefined && end > start;

  return {
    kind: "metric",
    metric: {
      type: "quota",
      id: window === "weekly" ? "weekly-pool" : "monthly-pool",
      label:
        window === "weekly" ? "Weekly usage pool" : "Monthly usage pool",
      scope: "general",
      usedRatio: percent / 100,
      cycle: {
        cadence: "calendar",
        resetsAt: end,
        ...(bounded ? { startedAt: start, durationMs: end - start } : {}),
      },
    },
  };
}

export function inspectDecodedCreditsConfig(
  config: DecodedCreditsConfig,
): UsagePoolInspection {
  if (config.billingFlagPresent && config.isUnifiedBillingUser === false) {
    return { kind: "absent", reason: "disabled" };
  }

  const hasPercent = config.creditUsagePercent !== undefined;
  const hasPeriod =
    config.currentPeriodType !== undefined ||
    config.currentPeriodEndMs !== undefined ||
    config.currentPeriodStartMs !== undefined;
  if (!hasPercent && !hasPeriod) {
    return {
      kind: "absent",
      reason: config.billingFlagPresent ? "empty" : "flag_missing",
    };
  }

  const percent = hasPercent ? config.creditUsagePercent : 0;
  if (percent === undefined || !Number.isFinite(percent)) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool has non-finite field: credit_usage_percent",
    };
  }
  if (percent < 0 || percent > 100) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool has out-of-range field: credit_usage_percent",
    };
  }

  if (config.currentPeriodType === undefined) {
    return {
      kind: "unparseable",
      message: "Grok usage-pool missing required field: current_period.type",
    };
  }
  const window =
    config.currentPeriodType === 2
      ? "weekly"
      : config.currentPeriodType === 1
        ? "monthly"
        : undefined;
  if (window === undefined) {
    return {
      kind: "unparseable",
      message:
        "Grok usage-pool has unrecognized field: current_period.type",
    };
  }

  if (config.currentPeriodEndMs === undefined) {
    return {
      kind: "unparseable",
      message: "Grok usage-pool missing required field: current_period.end",
    };
  }
  const end = config.currentPeriodEndMs;
  const start = config.currentPeriodStartMs;
  const bounded = start !== undefined && end > start;
  const usedRatio = percent / 100;
  const segments = poolSegments(percent, config.productUsage);

  return {
    kind: "metric",
    metric: {
      type: "quota",
      id: window === "weekly" ? "weekly-pool" : "monthly-pool",
      label:
        window === "weekly" ? "Weekly usage pool" : "Monthly usage pool",
      scope: "general",
      usedRatio,
      cycle: {
        cadence: "calendar",
        resetsAt: end,
        ...(bounded ? { startedAt: start, durationMs: end - start } : {}),
      },
      ...(segments === undefined ? {} : { segments }),
    },
  };
}

function poolSegments(
  parentPercent: number,
  productUsage: readonly DecodedProductUsage[],
): QuotaMetric["segments"] | undefined {
  const recognized: NonNullable<QuotaMetric["segments"]> = [];
  const seen = new Set<number>();
  let recognizedPercent = 0;

  for (const entry of productUsage) {
    const spec = PRODUCT_SEGMENTS[entry.product];
    if (spec === undefined) {
      if (entry.usagePercent !== 0) {
        return undefined;
      }
      continue;
    }
    if (
      !Number.isFinite(entry.usagePercent) ||
      entry.usagePercent < 0 ||
      entry.usagePercent > 100 ||
      seen.has(entry.product)
    ) {
      return undefined;
    }
    seen.add(entry.product);
    recognizedPercent += entry.usagePercent;
    recognized.push({
      id: spec.id,
      label: spec.label,
      usedRatio: entry.usagePercent / 100,
    });
  }

  if (recognized.length === 0) {
    return undefined;
  }
  // Raw proto percents first, then the usedRatio sum state-codec rechecks.
  if (Math.abs(recognizedPercent - parentPercent) > SEGMENT_SUM_TOLERANCE) {
    return undefined;
  }
  const sum = recognized.reduce((total, segment) => total + segment.usedRatio, 0);
  if (Math.abs(sum - parentPercent / 100) > SEGMENT_SUM_TOLERANCE) {
    return undefined;
  }
  return [...recognized].sort((left, right) => {
    const leftOrder = left.id === "grok-build" ? 0 : 1;
    const rightOrder = right.id === "grok-build" ? 0 : 1;
    return leftOrder - rightOrder;
  });
}

export function normalizeUsagePool(value: unknown): QuotaMetric | undefined {
  const inspected = inspectUsagePool(value);
  return inspected.kind === "metric" ? inspected.metric : undefined;
}

function unwrapPoolConfig(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const nested =
    asRecord(value.config) ??
    asRecord(value.grokCreditsConfig) ??
    asRecord(value.grok_credits_config);
  if (nested !== undefined) {
    return nested;
  }

  if (
    "creditUsagePercent" in value ||
    "credit_usage_percent" in value ||
    "currentPeriod" in value ||
    "current_period" in value ||
    "isUnifiedBillingUser" in value ||
    "is_unified_billing_user" in value
  ) {
    return value;
  }

  return undefined;
}

function unifiedBillingFlag(
  ...records: Array<Record<string, unknown> | undefined>
): "true" | "false" | "absent" {
  for (const record of records) {
    if (record === undefined) {
      continue;
    }
    if (
      !("isUnifiedBillingUser" in record) &&
      !("is_unified_billing_user" in record)
    ) {
      continue;
    }
    return pick(record, "isUnifiedBillingUser", "is_unified_billing_user") ===
      false
      ? "false"
      : "true";
  }
  return "absent";
}

function periodWindow(
  period: Record<string, unknown>,
): "weekly" | "monthly" | undefined {
  const type = pick(period, "type");
  if (typeof type === "number" && Number.isFinite(type)) {
    if (type === 1) {
      return "monthly";
    }
    if (type === 2) {
      return "weekly";
    }
    return undefined;
  }
  if (typeof type !== "string") {
    return undefined;
  }

  const normalized = type.trim().toUpperCase();
  if (normalized === "WEEKLY" || normalized === "USAGE_PERIOD_TYPE_WEEKLY") {
    return "weekly";
  }
  if (normalized === "MONTHLY" || normalized === "USAGE_PERIOD_TYPE_MONTHLY") {
    return "monthly";
  }
  return undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1_000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseTimestamp(Number(trimmed));
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const seconds = parseSeconds(record.seconds);
  if (seconds === undefined) {
    return undefined;
  }
  const nanos =
    typeof record.nanos === "number" && Number.isFinite(record.nanos)
      ? record.nanos
      : 0;
  return seconds * 1_000 + Math.floor(nanos / 1e6);
}

function parseSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function pickNumber(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
): number | undefined {
  const value = pick(record, camel, snake);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickRecord(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
): Record<string, unknown> | undefined {
  return asRecord(pick(record, camel, snake));
}

function pick(
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): unknown {
  if (camel in record) {
    return record[camel];
  }
  if (snake !== undefined && snake in record) {
    return record[snake];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
