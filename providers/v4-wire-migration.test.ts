import { describe, expect, test } from "vitest";

import { migrateState } from "./initial-state";

const NOW = Date.UTC(2030, 4, 1, 12);
const DAY = 24 * 60 * 60 * 1_000;

function releasedQuotaWindow(overrides: Record<string, unknown>) {
  return {
    id: "weekly",
    label: "Weekly usage",
    kind: "rolling",
    usedRatio: 0.4,
    startedAt: NOW - 5 * DAY,
    resetsAt: NOW + 2 * DAY,
    durationMs: 7 * DAY,
    sourceSemantics: "used",
    ...overrides,
  };
}

describe("released V4 wire migration", () => {
  test("preserves every released provider meaning and quota history boundary", () => {
    const releasedState = {
      version: 4,
      preferences: { displayMode: "left", autoRefresh: false },
      providers: [
        {
          providerId: "chatgpt",
          access: "granted",
          snapshot: {
            providerId: "chatgpt",
            planLabel: "Plus",
            source: "web-session",
            fetchedAt: NOW - DAY,
            windows: [releasedQuotaWindow({})],
            credits: [
              { id: "credits", label: "Credits", unit: "credits", remaining: 414 },
            ],
            usageGroups: [
              {
                id: "usage",
                label: "Usage",
                windowIds: ["weekly"],
                creditIds: ["credits"],
              },
            ],
          },
          history: [
            {
              observedAt: NOW - 2 * 60 * 60 * 1_000,
              windows: [
                {
                  windowId: "weekly",
                  usedRatio: 0.3,
                  startedAt: NOW - 5 * DAY,
                  resetsAt: NOW + 2 * DAY,
                  durationMs: 7 * DAY,
                },
              ],
            },
          ],
        },
        {
          providerId: "claude",
          access: "granted",
          snapshot: {
            providerId: "claude",
            source: "web-session",
            fetchedAt: NOW - DAY,
            windows: [releasedQuotaWindow({})],
            credits: [
              { id: "extra-usage", label: "Extra usage", unit: "USD", used: 8.2, limit: 20 },
            ],
          },
          history: [],
        },
        {
          providerId: "kimi",
          access: "granted",
          snapshot: {
            providerId: "kimi",
            source: "web-session",
            fetchedAt: NOW - DAY,
            windows: [
              releasedQuotaWindow({
                id: "monthly-total",
                label: "Monthly total",
                kind: "calendar",
                usedRatio: 0.25,
                segments: [
                  { id: "work", label: "Work", usedRatio: 0.15 },
                  { id: "code", label: "Code", usedRatio: 0.1 },
                ],
              }),
            ],
            credits: [],
          },
          history: [],
        },
        {
          providerId: "cursor",
          access: "granted",
          snapshot: {
            providerId: "cursor",
            source: "web-session",
            fetchedAt: NOW - DAY,
            windows: [
              releasedQuotaWindow({
                id: "cursor-models-monthly",
                label: "Cursor models",
                kind: "model",
              }),
            ],
            credits: [
              { id: "on-demand", label: "On-demand spend", unit: "USD", used: 3.2, limit: 20 },
            ],
          },
          history: [],
        },
        {
          providerId: "elevenlabs",
          access: "granted",
          snapshot: {
            providerId: "elevenlabs",
            source: "api-key",
            fetchedAt: NOW - DAY,
            windows: [
              releasedQuotaWindow({
                id: "monthly-credits",
                label: "Monthly credits",
                kind: "calendar",
                used: 2_500,
                limit: 10_000,
                unit: "credits",
              }),
              releasedQuotaWindow({
                id: "voice-slots",
                label: "Voice slots",
                kind: "feature",
                usedRatio: 0.2,
                used: 2,
                limit: 10,
                unit: "voices",
                startedAt: undefined,
                resetsAt: undefined,
                durationMs: undefined,
              }),
            ],
            credits: [],
          },
          history: [],
        },
        {
          providerId: "newapi",
          access: "granted",
          snapshot: {
            providerId: "newapi",
            source: "api-key",
            fetchedAt: NOW - DAY,
            windows: [],
            credits: [
              { id: "relay-key-usage", label: "API key usage", unit: "quota units", used: 42_000 },
            ],
          },
          history: [],
        },
      ],
    };

    const migrated = migrateState(releasedState, NOW);

    expect(migrated.preferences).toEqual({ displayMode: "left", autoRefresh: false });
    expect(migrated.providers[0]?.snapshot).toMatchObject({
      providerKind: "chatgpt",
      metrics: [
        expect.objectContaining({ type: "quota", id: "weekly", scope: "general" }),
        expect.objectContaining({ type: "balance", id: "credits", value: 414 }),
      ],
      usageGroups: [{ id: "usage", label: "Usage", metricIds: ["weekly", "credits"] }],
    });
    expect(migrated.providers[0]?.history).toEqual([
      {
        observedAt: NOW - 2 * 60 * 60 * 1_000,
        metrics: [
          {
            type: "quota",
            metricId: "weekly",
            usedRatio: 0.3,
            cycle: {
              cadence: "rolling",
              startedAt: NOW - 5 * DAY,
              resetsAt: NOW + 2 * DAY,
              durationMs: 7 * DAY,
            },
          },
        ],
      },
    ]);
    expect(migrated.providers[1]?.snapshot?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "counter", id: "extra-usage", semantic: "spent", value: 8.2, limit: 20 }),
      ]),
    );
    expect(migrated.providers[2]?.snapshot?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "quota",
          id: "monthly-total",
          segments: [
            { id: "work", label: "Work", usedRatio: 0.15 },
            { id: "code", label: "Code", usedRatio: 0.1 },
          ],
        }),
      ]),
    );
    expect(migrated.providers[3]?.snapshot?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "quota", id: "cursor-models-monthly", scope: "model" }),
        expect.objectContaining({ type: "counter", id: "on-demand", semantic: "spent", value: 3.2, limit: 20 }),
      ]),
    );
    expect(migrated.providers[4]?.snapshot?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "quota", id: "monthly-credits", scope: "product" }),
        expect.objectContaining({ type: "quota", id: "voice-slots", scope: "feature" }),
      ]),
    );
    expect(migrated.providers[5]?.snapshot?.metrics).toEqual([
      expect.objectContaining({
        type: "counter",
        id: "relay-key-usage",
        semantic: "consumed",
        value: 42_000,
      }),
    ]);
    expect(migrateState(migrated, NOW)).toEqual(migrated);
  });

  test.each([
    [
      "an unknown quota kind",
      {
        windows: [releasedQuotaWindow({ kind: "promotion" })],
        credits: [],
      },
    ],
    [
      "an incomplete usage group",
      {
        windows: [releasedQuotaWindow({})],
        credits: [],
        usageGroups: [{ id: "usage", label: "Usage", windowIds: ["weekly"] }],
      },
    ],
    [
      "a fixture-only source",
      {
        source: "fixture",
        windows: [releasedQuotaWindow({})],
        credits: [],
      },
    ],
  ])("does not use V4 compatibility to repair %s", (_name, fields) => {
    const migrated = migrateState(
      {
        version: 4,
        preferences: { displayMode: "used", autoRefresh: true },
        providers: [
          {
            providerId: "chatgpt",
            access: "granted",
            snapshot: {
              providerId: "chatgpt",
              source: "web-session",
              fetchedAt: NOW - DAY,
              ...fields,
            },
            history: [],
          },
        ],
      },
      NOW,
    );

    expect(migrated.providers[0]?.snapshot).toBeUndefined();
  });
});
