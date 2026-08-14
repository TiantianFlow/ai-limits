import { describe, expect, test } from "vitest";

import type { InstanceAppState } from "../domain/instances";
import { projectAppViewState } from "./view-state";

describe("public app view state", () => {
  test("allowlists instance fields and exposes only normalized dynamic origin display", () => {
    const durable = {
      version: 5,
      preferences: { displayMode: "left", autoRefresh: false, secretMode: true },
      instances: [
        {
          id: "newapi:550e8400-e29b-41d4-a716-446655440000",
          providerKind: "newapi",
          userLabel: "Relay",
          config: {
            kind: "dynamic-origin",
            baseUrl: "https://relay.example",
            apiKey: "must-not-escape",
          },
          access: "granted",
          createdAt: 1,
          history: [],
          credentialRevision: "revision-secret",
          lease: { token: "lease-secret" },
          rawMigrationState: { credential: "migration-secret" },
        },
      ],
      credentials: { value: "vault-secret" },
      repository: { storageKey: "raw-key" },
    } as unknown as InstanceAppState;

    const view = projectAppViewState(durable);

    expect(view).toEqual({
      preferences: { displayMode: "left", autoRefresh: false },
      instances: [
        {
          id: "newapi:550e8400-e29b-41d4-a716-446655440000",
          providerKind: "newapi",
          userLabel: "Relay",
          origin: "https://relay.example",
          access: "granted",
          createdAt: 1,
          history: [],
        },
      ],
    });
    const serialized = JSON.stringify(view);
    for (const secret of [
      "must-not-escape",
      "revision-secret",
      "lease-secret",
      "migration-secret",
      "vault-secret",
      "rawMigrationState",
      "repository",
      "config",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("copies only normalized metric, history, and attempt view data", () => {
    const state: InstanceAppState = {
      version: 5,
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [
        {
          id: "kimi:default",
          providerKind: "kimi",
          config: { kind: "fixed" },
          access: "required",
          createdAt: 2,
          history: [
            {
              observedAt: 1,
              metrics: [
                { type: "quota", metricId: "monthly", usedRatio: 0.4 },
              ],
            },
          ],
          snapshot: {
            providerKind: "kimi",
            source: "web-session",
            fetchedAt: 2,
            metrics: [
              {
                type: "quota",
                id: "monthly",
                label: "Monthly",
                scope: "general",
                usedRatio: 0.4,
              },
            ],
          },
          lastAttempt: {
            trigger: "scheduled",
            startedAt: 1,
            finishedAt: 2,
            outcome: { kind: "deferred", reason: "session_required" },
          },
        },
      ],
    };

    const view = projectAppViewState(state);

    expect(view.instances[0]).toMatchObject({
      id: "kimi:default",
      providerKind: "kimi",
      access: "required",
      snapshot: { metrics: [{ id: "monthly", usedRatio: 0.4 }] },
      history: [{ metrics: [{ metricId: "monthly", usedRatio: 0.4 }] }],
      lastAttempt: { outcome: { reason: "session_required" } },
    });
    expect(view.instances[0]).not.toHaveProperty("origin");
  });
});
