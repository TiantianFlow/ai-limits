import { describe, expect, test } from "vitest";

import { parseAppViewState } from "./public-protocol";

describe("public side-panel protocol", () => {
  test("reconstructs every accepted public state object instead of retaining source references", () => {
    const source = {
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [
        {
          id: "newapi:11111111-1111-4111-8111-111111111111",
          providerKind: "newapi",
          baseUrl: "https://relay.example/gateway",
          origin: "https://relay.example",
          access: "granted",
          createdAt: 10,
          history: [
            {
              observedAt: 11,
              metrics: [
                {
                  type: "quota",
                  metricId: "relay-quota",
                  usedRatio: 0.25,
                  cycle: { cadence: "rolling", durationMs: 60_000 },
                },
              ],
            },
          ],
          snapshot: {
            providerKind: "newapi",
            accountLabel: "Relay account",
            source: "api-key",
            fetchedAt: 11,
            metrics: [
              {
                type: "quota",
                id: "relay-quota",
                label: "Relay quota",
                scope: "feature",
                usedRatio: 0.25,
                segments: [
                  { id: "included", label: "Included", usedRatio: 0.2 },
                ],
              },
            ],
            usageGroups: [
              {
                id: "relay",
                label: "Relay",
                metricIds: ["relay-quota"],
              },
            ],
          },
          lastAttempt: {
            trigger: "manual_provider",
            startedAt: 10,
            finishedAt: 11,
            outcome: { kind: "success" },
          },
        },
      ],
    } as const;

    const parsed = parseAppViewState(source);

    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.preferences).not.toBe(source.preferences);
    expect(parsed.instances).not.toBe(source.instances);
    expect(parsed.instances[0]).not.toBe(source.instances[0]);
    expect(parsed.instances[0]!.history).not.toBe(source.instances[0]!.history);
    expect(parsed.instances[0]!.history[0]!.metrics).not.toBe(
      source.instances[0]!.history[0]!.metrics,
    );
    expect(parsed.instances[0]!.snapshot).not.toBe(source.instances[0]!.snapshot);
    expect(parsed.instances[0]!.snapshot!.metrics).not.toBe(
      source.instances[0]!.snapshot!.metrics,
    );
    expect(parsed.instances[0]!.snapshot!.usageGroups).not.toBe(
      source.instances[0]!.snapshot!.usageGroups,
    );
    expect(parsed.instances[0]!.lastAttempt).not.toBe(
      source.instances[0]!.lastAttempt,
    );

    parsed.instances[0]!.snapshot!.metrics[0]!.label = "Changed";
    expect(source.instances[0]!.snapshot.metrics[0]!.label).toBe("Relay quota");
  });

  test.each([
    "https://relay.example/gateway/",
    "https://relay.example/gateway/v1",
  ])("rejects a non-normalized public New API base URL %s", (baseUrl) => {
    expect(() =>
      parseAppViewState({
        preferences: { displayMode: "used", autoRefresh: true },
        instances: [
          {
            id: "newapi:11111111-1111-4111-8111-111111111111",
            providerKind: "newapi",
            baseUrl,
            origin: "https://relay.example",
            access: "granted",
            createdAt: 10,
            history: [],
          },
        ],
      }),
    ).toThrow("Missing application state");
  });

  test("rejects instance fields inherited from a prototype", () => {
    const inheritedId = Object.assign(
      Object.create({
        id: "newapi:11111111-1111-4111-8111-111111111111",
      }) as Record<string, unknown>,
      {
        providerKind: "newapi",
        baseUrl: "https://relay.example",
        origin: "https://relay.example",
        access: "granted",
        createdAt: 10,
        history: [],
      },
    );
    const inheritedOptional = Object.assign(
      Object.create({ userLabel: "Inherited relay" }) as Record<string, unknown>,
      {
        id: "newapi:22222222-2222-4222-8222-222222222222",
        providerKind: "newapi",
        baseUrl: "https://relay.example/gateway",
        origin: "https://relay.example",
        access: "granted",
        createdAt: 11,
        history: [],
      },
    );

    for (const instance of [inheritedId, inheritedOptional]) {
      expect(() =>
        parseAppViewState({
          preferences: { displayMode: "used", autoRefresh: true },
          instances: [instance],
        }),
      ).toThrow("Missing application state");
    }
  });
});
