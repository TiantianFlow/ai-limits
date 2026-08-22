import type { UsageMetric, UsageSnapshot } from "../../domain/model";
import type { CollectionResult } from "../types";
import {
  normalizeExtraUsageCredits,
  normalizeGrokStatus,
} from "./adapter";
import type { CursorDashboardProbe } from "./page-dashboard";
import {
  cursorCreditGrantsBalanceSchema,
  cursorGrokStatusSchema,
} from "./schema";

export const GROK_BOT_METRIC_ID = "grok-bot-weekly";
export const EXTRA_CREDITS_METRIC_ID = "extra-usage-credits";

export type CursorPageReason =
  | "scheduled"
  | "no-tab"
  | "injection"
  | "network"
  | `http:${number}`
  | "mismatch"
  | "unavailable";

export type CursorGrokClassification =
  | "absent"
  | "ready"
  | "unavailable"
  | "mismatch";

export type CursorCreditsClassification =
  | "absent"
  | "ready"
  | "empty"
  | "mismatch";

export function classifyCursorGrokStatus(
  value: unknown,
): CursorGrokClassification {
  if (value === undefined) return "absent";
  const parsed = cursorGrokStatusSchema.safeParse(value);
  if (!parsed.success) return "mismatch";
  if (normalizeGrokStatus(parsed.data) !== undefined) return "ready";
  if (
    parsed.data.hasAvailableUsage === false ||
    parsed.data.hasNonZeroIncludedLimit === false
  ) {
    return "unavailable";
  }
  return "mismatch";
}

export function classifyCursorCredits(
  value: unknown,
): CursorCreditsClassification {
  if (value === undefined) return "absent";
  const parsed = cursorCreditGrantsBalanceSchema.safeParse(value);
  if (!parsed.success) return "mismatch";
  if (normalizeExtraUsageCredits(parsed.data) !== undefined) return "ready";
  return "empty";
}

export function cursorPageDescriptionToken(
  carried: boolean,
  reason: CursorPageReason,
): string {
  return carried ? `cursor:carried:${reason}` : `cursor:${reason}`;
}

function grokReasonFromProbe(
  probe: CursorDashboardProbe | { kind: "skipped" },
): CursorPageReason {
  if (probe.kind === "skipped") return "scheduled";
  if (probe.kind === "no_tab") return "no-tab";
  if (probe.kind === "injection_failed") return "injection";
  if (!probe.grok.ok) {
    return probe.grok.status === undefined
      ? "network"
      : `http:${probe.grok.status}`;
  }
  const classification = classifyCursorGrokStatus(probe.grok.value);
  if (classification === "unavailable") return "unavailable";
  if (classification === "ready" || classification === "absent") {
    return "mismatch";
  }
  return "mismatch";
}

function stampObservedAt(metric: UsageMetric, observedAt: number): UsageMetric {
  return metric.observedAt === undefined ? { ...metric, observedAt } : metric;
}

function previousPageMetric(
  previous: UsageSnapshot | undefined,
  id: string,
): UsageMetric | undefined {
  return previous?.metrics.find((metric) => metric.id === id);
}

function grokStillValid(metric: UsageMetric, now: number): boolean {
  const resetsAt = metric.type === "quota" ? metric.cycle?.resetsAt : undefined;
  return resetsAt !== undefined && now < resetsAt;
}

function carryGrok(
  previous: UsageSnapshot | undefined,
  now: number,
  allowCarry: boolean,
): UsageMetric | undefined {
  if (!allowCarry) return undefined;
  const metric = previousPageMetric(previous, GROK_BOT_METRIC_ID);
  if (metric === undefined || !grokStillValid(metric, now)) return undefined;
  return stampObservedAt(metric, previous?.fetchedAt ?? now);
}

function carryCredits(
  previous: UsageSnapshot | undefined,
  now: number,
): UsageMetric | undefined {
  const metric = previousPageMetric(previous, EXTRA_CREDITS_METRIC_ID);
  return metric === undefined
    ? undefined
    : stampObservedAt(metric, previous?.fetchedAt ?? now);
}

export function applyCursorPageMetrics(
  result: CollectionResult,
  previous: UsageSnapshot | undefined,
  probe: CursorDashboardProbe | { kind: "skipped" },
  now: number,
): CollectionResult {
  if (!result.ok) return result;

  const reason = grokReasonFromProbe(probe);
  const freshGrok = result.snapshot.metrics.find(
    (metric) => metric.id === GROK_BOT_METRIC_ID,
  );
  const freshCredits = result.snapshot.metrics.find(
    (metric) => metric.id === EXTRA_CREDITS_METRIC_ID,
  );
  const allowGrokCarry = reason !== "unavailable";
  const grok =
    freshGrok === undefined
      ? carryGrok(previous, now, allowGrokCarry)
      : stampObservedAt(freshGrok, now);
  const creditsFreshlyEmpty =
    probe.kind === "read" &&
    probe["credits"].ok &&
    classifyCursorCredits(probe["credits"].value) === "empty";
  const credits =
    freshCredits === undefined
      ? creditsFreshlyEmpty
        ? undefined
        : carryCredits(previous, now)
      : stampObservedAt(freshCredits, now);
  const grokCarried = freshGrok === undefined && grok !== undefined;
  const creditsCarried = freshCredits === undefined && credits !== undefined;
  const carried = grokCarried || creditsCarried;

  const metrics = [
    ...result.snapshot.metrics.filter(
      (metric) =>
        metric.id !== GROK_BOT_METRIC_ID &&
        metric.id !== EXTRA_CREDITS_METRIC_ID,
    ),
    ...(grok === undefined ? [] : [grok]),
    ...(credits === undefined ? [] : [credits]),
  ];

  const description =
    reason === "unavailable"
      ? cursorPageDescriptionToken(false, reason)
      : freshGrok !== undefined && !carried
        ? undefined
        : cursorPageDescriptionToken(carried, reason);

  return {
    ok: true,
    snapshot: {
      ...result.snapshot,
      metrics,
      usageGroups: [
        {
          id: "usage",
          label: result.snapshot.usageGroups?.[0]?.label ?? "Usage",
          ...(description === undefined ? {} : { description }),
          metricIds: metrics.map((metric) => metric.id),
        },
      ],
    },
  };
}
