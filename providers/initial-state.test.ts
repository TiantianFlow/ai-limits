import { describe, expect, test } from "vitest";

import { createInitialState, migrateState, normalizeUsageSnapshot } from "./initial-state";

const snapshot = {
  providerKind: "elevenlabs",
  source: "api-key",
  fetchedAt: 1_700_000_000_000,
  metrics: [
    {
      type: "quota",
      id: "monthly",
      label: "Monthly credits",
      scope: "product",
      usedRatio: 0.25,
      used: 25,
      limit: 100,
      unit: "credits",
      cycle: { cadence: "calendar", startedAt: 1_000, resetsAt: 2_000, durationMs: 1_000 },
      segments: [
        { id: "voice", label: "Voice", usedRatio: 0.1 },
        { id: "other", label: "Other", usedRatio: 0.15 },
      ],
    },
    {
      type: "counter",
      id: "spend",
      label: "Spend",
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
      value: 414,
      unit: "credits",
      initialLimit: 500,
    },
  ],
  usageGroups: [
    { id: "usage", label: "Usage", metricIds: ["monthly", "spend", "credits"] },
  ],
};
const { usageGroups: _usageGroups, ...ungroupedSnapshot } = snapshot;

describe("persisted provider snapshots", () => {
  test("accepts API-key snapshots from known providers", () => {
    expect(normalizeUsageSnapshot(snapshot, "elevenlabs")).toEqual(snapshot);
  });

  test("rejects unknown snapshot sources", () => {
    expect(
      normalizeUsageSnapshot({ ...snapshot, source: "unknown" }, "elevenlabs"),
    ).toBeUndefined();
  });

  test("rejects a mismatched provider kind", () => {
    expect(
      normalizeUsageSnapshot({ ...snapshot, providerKind: "chatgpt" }, "elevenlabs"),
    ).toBeUndefined();
  });

  test("rejects duplicate metric IDs instead of collapsing their meanings", () => {
    expect(
      normalizeUsageSnapshot(
        { ...ungroupedSnapshot, metrics: [...snapshot.metrics, snapshot.metrics[0]] },
        "elevenlabs",
      ),
    ).toBeUndefined();
  });

  test.each([
    ["negative quota values", { ...snapshot.metrics[0], used: -1 }],
    ["quota ratios above one", { ...snapshot.metrics[0], usedRatio: 1.01 }],
    ["zero quota limits", { ...snapshot.metrics[0], limit: 0 }],
    ["backwards cycles", { ...snapshot.metrics[0], cycle: { startedAt: 2_000, resetsAt: 1_000 } }],
    ["unknown cycle cadences", { ...snapshot.metrics[0], cycle: { cadence: "weekly" } }],
    ["non-positive cycle durations", { ...snapshot.metrics[0], cycle: { durationMs: 0 } }],
    ["non-finite counter values", { ...snapshot.metrics[1], value: Number.NaN }],
    ["negative counter values", { ...snapshot.metrics[1], value: -1 }],
    ["zero counter limits", { ...snapshot.metrics[1], limit: 0 }],
    ["negative balances", { ...snapshot.metrics[2], value: -1 }],
    ["zero initial balances", { ...snapshot.metrics[2], initialLimit: 0 }],
  ])("rejects %s", (_label, metric) => {
    expect(
      normalizeUsageSnapshot({ ...ungroupedSnapshot, metrics: [metric] }, "elevenlabs"),
    ).toBeUndefined();
  });

  test.each([
    ["out-of-range segments", [{ id: "bad", label: "Bad", usedRatio: 1.1 }]],
    ["duplicate segment IDs", [
      { id: "same", label: "One", usedRatio: 0.1 },
      { id: "same", label: "Two", usedRatio: 0.15 },
    ]],
    ["segment sums that change the total", [
      { id: "one", label: "One", usedRatio: 0.1 },
      { id: "two", label: "Two", usedRatio: 0.1 },
    ]],
  ])("rejects %s", (_label, segments) => {
    expect(
      normalizeUsageSnapshot(
        { ...ungroupedSnapshot, metrics: [{ ...snapshot.metrics[0], segments }] },
        "elevenlabs",
      ),
    ).toBeUndefined();
  });

  test.each([
    ["unknown membership", [{ id: "usage", label: "Usage", metricIds: ["missing"] }]],
    ["duplicate membership", [{ id: "usage", label: "Usage", metricIds: ["monthly", "monthly"] }]],
    ["missing membership", [{ id: "usage", label: "Usage", metricIds: ["monthly", "spend"] }]],
  ])("rejects groups with %s", (_label, usageGroups) => {
    expect(
      normalizeUsageSnapshot({ ...snapshot, usageGroups }, "elevenlabs"),
    ).toBeUndefined();
  });
});

describe("persisted credential failures", () => {
  test.each([
    [
      "credential_invalid",
      "The API key is invalid. Enter a valid key and try again.",
    ],
    [
      "credential_scope_required",
      "The API key cannot read usage. Update its permissions and try again.",
    ],
  ] as const)("normalizes %s to its fixed sanitized message", (category, message) => {
    const state = createInitialState();
    state.providers[4] = {
      ...state.providers[4]!,
      access: "granted",
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_001_000,
        outcome: {
          kind: "failure",
          category,
          message: `provider body with secret: ${category}`,
        },
      },
    };

    expect(migrateState(state, 1_700_000_001_000).providers[4]?.lastAttempt)
      .toEqual({
        trigger: "manual_provider",
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_001_000,
        outcome: { kind: "failure", category, message },
      });
  });
});
