import { describe, expect, test } from "vitest";

import type { ProviderInstanceRecord } from "../domain/model";
import {
  createEmptyInstanceAppState,
  normalizeInstanceAppState,
} from "./state-codec";

const now = Date.parse("2030-05-01T12:00:00.000Z");
const hour = 60 * 60 * 1_000;
const day = 24 * hour;

function newApiInstance(
  id: string,
  userLabel: string,
): ProviderInstanceRecord {
  return {
    id,
    providerKind: "newapi",
    userLabel,
    config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
    access: "granted",
    createdAt: now - day,
    history: [],
    snapshot: {
      providerKind: "newapi",
      source: "api-key",
      fetchedAt: now - hour,
      metrics: [
        {
          type: "quota",
          id: "relay-key-quota",
          label: "API key quota",
          scope: "product",
          usedRatio: 0.4,
          used: 40,
          limit: 100,
          unit: "quota units",
        },
      ],
    },
  };
}

describe("V5 instance state codec", () => {
  test("starts with zero instances instead of materializing the catalog", () => {
    expect(createEmptyInstanceAppState()).toEqual({
      version: 5,
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [],
    });
    expect(normalizeInstanceAppState(undefined, now)).toEqual(
      createEmptyInstanceAppState(),
    );
  });

  test("keeps multiple New API instances sharing one normalized origin", () => {
    const state = normalizeInstanceAppState(
      {
        version: 5,
        preferences: { displayMode: "left", autoRefresh: false },
        instances: [
          newApiInstance(
            "newapi:550e8400-e29b-41d4-a716-446655440000",
            "Personal relay",
          ),
          newApiInstance(
            "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
            "Work relay",
          ),
        ],
      },
      now,
    );

    expect(state.instances.map(({ id }) => id)).toEqual([
      "newapi:550e8400-e29b-41d4-a716-446655440000",
      "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
    ]);
    expect(state.instances.map(({ config }) => config)).toEqual([
      { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      { kind: "dynamic-origin", baseUrl: "https://relay.example" },
    ]);
  });

  test("normalizes instance config through its package without dropping a base path", () => {
    const instance = newApiInstance("newapi:default", "Gateway relay");
    instance.config = {
      kind: "dynamic-origin",
      baseUrl: "https://API.example/gateway/v1/messages",
    };

    expect(
      normalizeInstanceAppState(
        {
          version: 5,
          preferences: { displayMode: "used", autoRefresh: true },
          instances: [instance],
        },
        now,
      ).instances[0]?.config,
    ).toEqual({
      kind: "dynamic-origin",
      baseUrl: "https://api.example/gateway",
    });
  });

  test("validates the internal connection revision without projecting malformed bindings", () => {
    const valid = {
      ...newApiInstance("newapi:default", "Gateway relay"),
      connectionRevision: "550e8400-e29b-41d4-a716-446655440099",
    };
    const malformed = {
      ...newApiInstance(
        "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
        "Malformed relay",
      ),
      connectionRevision: " revision with spaces ",
    };

    const state = normalizeInstanceAppState(
      {
        version: 5,
        preferences: { displayMode: "used", autoRefresh: true },
        instances: [valid, malformed],
      },
      now,
    );

    expect(state.instances[0]).toMatchObject({
      connectionRevision: "550e8400-e29b-41d4-a716-446655440099",
    });
    expect(state.instances[1]).not.toHaveProperty("connectionRevision");
  });

  test("drops duplicate IDs, singleton siblings, and connection-mode mismatches independently", () => {
    const firstChatGpt: ProviderInstanceRecord = {
      id: "chatgpt:default",
      providerKind: "chatgpt",
      config: { kind: "fixed" },
      access: "granted",
      createdAt: now,
      history: [],
    };
    const state = normalizeInstanceAppState(
      {
        version: 5,
        preferences: { displayMode: "used", autoRefresh: true },
        instances: [
          firstChatGpt,
          { ...firstChatGpt, id: "chatgpt:550e8400-e29b-41d4-a716-446655440000" },
          newApiInstance("newapi:default", "First"),
          newApiInstance("newapi:default", "Duplicate ID"),
          {
            ...newApiInstance(
              "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
              "Wrong config",
            ),
            config: { kind: "fixed" },
          },
          {
            ...firstChatGpt,
            id: "claude:default",
            providerKind: "claude",
            config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
          },
        ],
      },
      now,
    );

    expect(state.instances.map(({ id }) => id)).toEqual([
      "chatgpt:default",
      "newapi:default",
    ]);
  });

  test("drops a malformed snapshot without leaking secret-bearing fields", () => {
    const instance = {
      ...newApiInstance("newapi:default", "Personal relay"),
      apiKey: "synthetic-secret",
      credential: { value: "synthetic-secret" },
      snapshot: {
        ...newApiInstance("newapi:default", "Personal relay").snapshot,
        metrics: [
          {
            type: "quota",
            id: "duplicate",
            label: "First",
            scope: "product",
            usedRatio: 0.2,
          },
          {
            type: "quota",
            id: "duplicate",
            label: "Second",
            scope: "product",
            usedRatio: 0.3,
          },
        ],
      },
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: now - 1_000,
        finishedAt: now,
        outcome: {
          kind: "failure",
          category: "credential_invalid",
          message: "provider response synthetic-secret",
        },
      },
    };

    const state = normalizeInstanceAppState(
      { version: 5, preferences: {}, instances: [instance] },
      now,
    );

    expect(state.instances[0]).not.toHaveProperty("snapshot");
    expect(state.instances[0]?.lastAttempt?.outcome).toEqual({
      kind: "failure",
      category: "credential_invalid",
      message: "The API key is invalid. Enter a valid key and try again.",
    });
    expect(JSON.stringify(state)).not.toMatch(
      /synthetic-secret|apiKey|\"credential\"/,
    );
  });

  test("rejects duplicate metric IDs in history and prunes retention on startup", () => {
    const compactedHour = Math.floor((now - 3 * day) / hour) * hour;
    const instance = newApiInstance("newapi:default", "Personal relay");
    instance.history = [
      {
        observedAt: now - 31 * day,
        metrics: [{ type: "quota", metricId: "quota", usedRatio: 0.1 }],
      },
      {
        observedAt: compactedHour + 5 * 60 * 1_000,
        metrics: [{ type: "quota", metricId: "quota", usedRatio: 0.2 }],
      },
      {
        observedAt: compactedHour + 55 * 60 * 1_000,
        metrics: [{ type: "quota", metricId: "quota", usedRatio: 0.3 }],
      },
      {
        observedAt: now - hour,
        metrics: [
          { type: "quota", metricId: "duplicate", usedRatio: 0.4 },
          { type: "quota", metricId: "duplicate", usedRatio: 0.5 },
        ],
      },
      {
        observedAt: now - 30 * 60 * 1_000,
        metrics: [
          {
            type: "counter",
            metricId: "spend",
            semantic: "spent",
            value: 5,
            unit: "USD",
          },
          {
            type: "balance",
            metricId: "credits",
            value: 10,
            unit: "credits",
          },
        ],
      },
    ];

    const [normalized] = normalizeInstanceAppState(
      {
        version: 5,
        preferences: { displayMode: "used", autoRefresh: true },
        instances: [instance],
      },
      now,
    ).instances;

    expect(normalized?.history).toEqual([
      {
        observedAt: compactedHour + 55 * 60 * 1_000,
        metrics: [{ type: "quota", metricId: "quota", usedRatio: 0.3 }],
      },
      {
        observedAt: now - 30 * 60 * 1_000,
        metrics: [
          {
            type: "counter",
            metricId: "spend",
            semantic: "spent",
            value: 5,
            unit: "USD",
          },
          {
            type: "balance",
            metricId: "credits",
            value: 10,
            unit: "credits",
          },
        ],
      },
    ]);
  });
});
