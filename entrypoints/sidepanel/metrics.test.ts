import { describe, expect, test } from "vitest";

import type {
  BalanceMetric,
  CounterMetric,
  UsageMetric,
  UsageSnapshot,
} from "../../domain/model";
import { normalizeUsageSnapshot } from "../../providers/initial-state";
import {
  balanceMetrics,
  counterMetrics,
  quotaMetrics,
} from "./metrics";

const snapshot: UsageSnapshot = {
  providerKind: "chatgpt",
  source: "fixture",
  fetchedAt: 1_000,
  metrics: [],
};

const metricOnlyUsageSnapshot: UsageSnapshot = {
  providerKind: "chatgpt",
  source: "fixture",
  fetchedAt: 1_000,
  metrics: [],
  usageGroups: [
    {
      id: "usage",
      label: "Usage",
      metricIds: ["weekly"],
    },
  ],
};

const metrics: UsageMetric[] = [
  {
    type: "quota",
    id: "weekly",
    label: "Weekly messages",
    scope: "general",
    usedRatio: 0.4,
    cycle: { cadence: "rolling", resetsAt: 2_000, durationMs: 1_000 },
  },
  {
    type: "counter",
    id: "spend",
    label: "On-demand spend",
    scope: "product",
    semantic: "spent",
    value: 12.5,
    unit: "USD",
    limit: 50,
  },
  {
    type: "balance",
    id: "credits",
    label: "Credits",
    scope: "product",
    value: 177.697,
    unit: "credits",
  },
];

const counterWithQuotaRatio = {
  type: "counter",
  id: "counter",
  label: "Counter",
  scope: "product",
  semantic: "consumed",
  value: 1,
  unit: "requests",
  // @ts-expect-error A counter must not use quota's ratio representation.
  usedRatio: 0.4,
} satisfies CounterMetric;

const balanceWithSpentSemantic = {
  type: "balance",
  id: "balance",
  label: "Balance",
  scope: "product",
  // @ts-expect-error A balance has no consumption semantic.
  semantic: "spent",
  value: 1,
  unit: "credits",
} satisfies BalanceMetric;

void counterWithQuotaRatio;
void balanceWithSpentSemantic;

describe("usage metrics", () => {
  test("selects canonical quota, counter, and balance metrics by discriminant", () => {
    expect(metricOnlyUsageSnapshot.usageGroups).toEqual([
      { id: "usage", label: "Usage", metricIds: ["weekly"] },
    ]);
    expect(quotaMetrics({ ...snapshot, metrics })).toHaveLength(1);
    expect(counterMetrics({ ...snapshot, metrics })[0]?.semantic).toBe("spent");
    expect(balanceMetrics({ ...snapshot, metrics })[0]?.value).toBe(177.697);
  });

  test("rejects duplicate metric IDs through the Task 2 normalization seam", () => {
    expect(
      normalizeUsageSnapshot(
        { ...snapshot, metrics: [metrics[0], { ...metrics[0] }] },
        "chatgpt",
      ),
    ).toBeUndefined();
  });
});
