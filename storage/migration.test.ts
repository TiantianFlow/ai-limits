import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  migrateLegacyStorage,
  migrateLegacyStorageInPlace,
} from "./migration";

const now = Date.parse("2030-05-01T12:00:00.000Z");
const hour = 60 * 60 * 1_000;
const day = 24 * hour;

function releasedQuotaWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: "weekly",
    label: "Weekly usage",
    kind: "rolling",
    usedRatio: 0.4,
    startedAt: now - 5 * day,
    resetsAt: now + 2 * day,
    durationMs: 7 * day,
    sourceSemantics: "used",
    ...overrides,
  };
}

function releasedProvider(
  providerId: string,
  fields: Record<string, unknown> = {},
) {
  return {
    providerId,
    access: "granted",
    snapshot: {
      providerId,
      source:
        providerId === "elevenlabs" || providerId === "newapi"
          ? "api-key"
          : "web-session",
      fetchedAt: now - hour,
      windows: [releasedQuotaWindow()],
      credits: [],
      ...fields,
    },
    history: [],
  };
}

function releasedState(providers: unknown[]) {
  return {
    version: 4,
    preferences: { displayMode: "left", autoRefresh: false },
    providers,
  };
}

function legacyInput(overrides: Record<string, unknown> = {}) {
  return {
    aiLimitsState: releasedState([]),
    aiLimitsCredentials: { version: 1, providers: {} },
    aiLimitsConnectionSuppressions: [],
    ...overrides,
  };
}

describe("published 0.2.3 storage migration", () => {
  test("keeps pristine state empty instead of creating every catalog provider", () => {
    const result = migrateLegacyStorage(
      legacyInput({
        aiLimitsState: releasedState([
          { providerId: "chatgpt", access: "required", history: [] },
          { providerId: "claude", access: "required", history: [] },
          { providerId: "kimi", access: "required", history: [] },
          { providerId: "cursor", access: "required", history: [] },
          { providerId: "elevenlabs", access: "required", history: [] },
          { providerId: "newapi", access: "required", history: [] },
        ]),
      }),
      now,
      {},
    );

    expect(result).toEqual({
      state: {
        version: 5,
        preferences: { displayMode: "left", autoRefresh: false },
        instances: [],
      },
      credentialState: { version: 2, credentials: {} },
    });
  });

  test("moves released singleton data, quota history, and instance-keyed API credentials", () => {
    const result = migrateLegacyStorage(
      legacyInput({
        aiLimitsState: releasedState([
          {
            ...releasedProvider("chatgpt", {
              credits: [
                {
                  id: "credits",
                  label: "Credits",
                  unit: "credits",
                  remaining: 414,
                },
              ],
            }),
            history: [
              {
                observedAt: now - 2 * hour,
                windows: [
                  {
                    windowId: "weekly",
                    usedRatio: 0.3,
                    startedAt: now - 5 * day,
                    resetsAt: now + 2 * day,
                    durationMs: 7 * day,
                  },
                ],
              },
            ],
          },
          releasedProvider("claude", {
            credits: [
              {
                id: "extra-usage",
                label: "Extra usage",
                unit: "USD",
                used: 8.2,
                limit: 20,
              },
            ],
          }),
          releasedProvider("cursor", {
            credits: [
              {
                id: "on-demand",
                label: "On-demand spend",
                unit: "USD",
                used: 3.2,
                limit: 20,
              },
            ],
          }),
          { providerId: "elevenlabs", access: "required", history: [] },
          { providerId: "newapi", access: "required", history: [] },
        ]),
        aiLimitsCredentials: {
          version: 1,
          providers: {
            elevenlabs: {
              kind: "api-key",
              value: "  synthetic-eleven-key  ",
              status: "active",
              revision: "eleven-revision",
            },
            newapi: {
              kind: "api-key",
              value: "  synthetic-relay-key  ",
              baseUrl: "https://RELAY.example/gateway/v1/messages",
              status: "rejected",
              revision: "relay-revision",
            },
          },
        },
      }),
      now,
      {
        origins: [
          "https://chatgpt.com/*",
          "https://claude.ai/*",
          "https://cursor.com/*",
          "https://api.elevenlabs.io/*",
          "https://relay.example/*",
        ],
      },
    );

    expect(result.state.instances.map(({ id }) => id)).toEqual([
      "chatgpt:default",
      "claude:default",
      "cursor:default",
      "elevenlabs:default",
      "newapi:default",
    ]);
    expect(result.state.instances.find(({ id }) => id === "newapi:default"))
      .toMatchObject({
        providerKind: "newapi",
        connectionRevision: "relay-revision",
        config: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/gateway",
        },
        access: "granted",
      });
    expect(result.state.instances.find(({ id }) => id === "elevenlabs:default"))
      .toMatchObject({ connectionRevision: "eleven-revision" });
    expect(result.credentialState).toEqual({
      version: 2,
      credentials: {
        "elevenlabs:default": {
          kind: "api-key",
          value: "synthetic-eleven-key",
          status: "active",
          revision: "eleven-revision",
        },
        "newapi:default": {
          kind: "api-key",
          value: "synthetic-relay-key",
          status: "rejected",
          revision: "relay-revision",
        },
      },
    });
    expect(result.credentialState.credentials["newapi:default"])
      .not.toHaveProperty("baseUrl");

    const chatgpt = result.state.instances.find(
      ({ id }) => id === "chatgpt:default",
    );
    expect(chatgpt?.snapshot?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "balance", id: "credits", value: 414 }),
      ]),
    );
    expect(chatgpt?.history).toEqual([
      {
        observedAt: now - 2 * hour,
        metrics: [
          {
            type: "quota",
            metricId: "weekly",
            usedRatio: 0.3,
            cycle: {
              cadence: "rolling",
              startedAt: now - 5 * day,
              resetsAt: now + 2 * day,
              durationMs: 7 * day,
            },
          },
        ],
      },
    ]);
    expect(
      result.state.instances.find(({ id }) => id === "claude:default")
        ?.snapshot?.metrics,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "counter",
          id: "extra-usage",
          semantic: "spent",
          value: 8.2,
        }),
      ]),
    );
    expect(
      result.state.instances.find(({ id }) => id === "cursor:default")
        ?.snapshot?.metrics,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "counter",
          id: "on-demand",
          semantic: "spent",
          value: 3.2,
        }),
      ]),
    );
    expect(
      result.state.instances.flatMap(({ history }) =>
        history.flatMap(({ metrics }) => metrics),
      ),
    ).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ type: "counter" }),
      expect.objectContaining({ type: "balance" }),
    ]));
  });

  test("suppression wins over data, credentials, and granted permission", () => {
    const result = migrateLegacyStorage(
      legacyInput({
        aiLimitsState: releasedState([releasedProvider("claude")]),
        aiLimitsCredentials: {
          version: 1,
          providers: {
            elevenlabs: {
              kind: "api-key",
              value: "synthetic-eleven-key",
              status: "active",
              revision: "revision",
            },
          },
        },
        aiLimitsConnectionSuppressions: ["claude", "elevenlabs"],
      }),
      now,
      {
        origins: ["https://claude.ai/*", "https://api.elevenlabs.io/*"],
      },
    );

    expect(result.state.instances).toEqual([]);
    expect(result.credentialState.credentials).toEqual({});
  });

  test("drops a malformed provider without dropping a valid sibling", () => {
    const result = migrateLegacyStorage(
      legacyInput({
        aiLimitsState: releasedState([
          releasedProvider("chatgpt"),
          releasedProvider("claude", {
            windows: [releasedQuotaWindow({ kind: "promotion" })],
          }),
        ]),
      }),
      now,
      {},
    );

    expect(result.state.instances.map(({ id }) => id)).toEqual([
      "chatgpt:default",
    ]);
  });

  test("does not treat a typed fixture snapshot as released 0.2.3 wire data", () => {
    const result = migrateLegacyStorage(
      legacyInput({
        aiLimitsState: releasedState([
          {
            providerId: "chatgpt",
            access: "granted",
            snapshot: {
              providerKind: "chatgpt",
              source: "fixture",
              fetchedAt: now - hour,
              metrics: [
                {
                  type: "quota",
                  id: "weekly",
                  label: "Weekly usage",
                  scope: "general",
                  usedRatio: 0.4,
                },
              ],
            },
            history: [],
          },
        ]),
      }),
      now,
      {},
    );

    expect(result.state.instances).toEqual([]);
  });

  test("creates permission-only browser singletons but not dynamic New API", () => {
    const result = migrateLegacyStorage(
      legacyInput(),
      now,
      {
        origins: ["https://chatgpt.com/*", "https://relay.example/*"],
      },
    );

    expect(result.state.instances).toEqual([
      {
        id: "chatgpt:default",
        providerKind: "chatgpt",
        config: { kind: "fixed" },
        access: "granted",
        createdAt: now,
        history: [],
      },
    ]);
  });

  test.each([
    "https://*/",
    "https://chatgpt.com/usage*",
  ])(
    "ignores the valid path in a fixed-provider host permission: %s",
    (origin) => {
      const result = migrateLegacyStorage(
        legacyInput({
          aiLimitsConnectionSuppressions: ["claude", "kimi", "cursor"],
        }),
        now,
        { origins: [origin] },
      );

      expect(result.state.instances).toEqual([
        {
          id: "chatgpt:default",
          providerKind: "chatgpt",
          config: { kind: "fixed" },
          access: "granted",
          createdAt: now,
          history: [],
        },
      ]);
    },
  );

  test("treats a broad granted HTTPS pattern as covering a dynamic New API origin", () => {
    const result = migrateLegacyStorage(
      legacyInput({
        aiLimitsConnectionSuppressions: ["chatgpt", "claude", "kimi", "cursor"],
        aiLimitsCredentials: {
          version: 1,
          providers: {
            newapi: {
              kind: "api-key",
              value: "synthetic-relay-key",
              baseUrl: "https://relay.example/v1/messages",
              status: "active",
              revision: "relay-revision",
            },
          },
        },
      }),
      now,
      { origins: ["https://*/*"] },
    );

    expect(result.state.instances).toEqual([
      {
        id: "newapi:default",
        providerKind: "newapi",
        config: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example",
        },
        connectionRevision: "relay-revision",
        access: "granted",
        createdAt: now,
        history: [],
      },
    ]);
  });

  test.each([
    [
      "a wildcard subdomain",
      "https://api.example.com/v1/messages",
      "https://*.example.com/account*",
      "https://api.example.com",
    ],
    [
      "an explicit port",
      "https://relay.example:8443/v1/messages",
      "https://relay.example:8443/usage*",
      "https://relay.example:8443",
    ],
  ])(
    "covers a dynamic New API origin with %s and ignores its valid path",
    (_label, baseUrl, grantedOrigin, normalizedBaseUrl) => {
      const result = migrateLegacyStorage(
        legacyInput({
          aiLimitsConnectionSuppressions: [
            "chatgpt",
            "claude",
            "kimi",
            "cursor",
          ],
          aiLimitsCredentials: {
            version: 1,
            providers: {
              newapi: {
                kind: "api-key",
                value: "synthetic-relay-key",
                baseUrl,
                status: "active",
                revision: "relay-revision",
              },
            },
          },
        }),
        now,
        { origins: [grantedOrigin] },
      );

      expect(result.state.instances).toEqual([
        {
          id: "newapi:default",
          providerKind: "newapi",
          config: {
            kind: "dynamic-origin",
            baseUrl: normalizedBaseUrl,
          },
          connectionRevision: "relay-revision",
          access: "granted",
          createdAt: now,
          history: [],
        },
      ]);
    },
  );

  test.each([
    "ftp://*/*",
    "https://**/*",
    "https://*/bad path",
  ])(
    "fails closed when a granted origin is not a valid match pattern: %s",
    (origin) => {
      const result = migrateLegacyStorage(
        legacyInput({
          aiLimitsState: releasedState([releasedProvider("chatgpt")]),
          aiLimitsCredentials: {
            version: 1,
            providers: {
              newapi: {
                kind: "api-key",
                value: "synthetic-relay-key",
                baseUrl: "https://relay.example/v1/messages",
                status: "active",
                revision: "relay-revision",
              },
            },
          },
        }),
        now,
        { origins: [origin] },
      );

      expect(
        result.state.instances.map(({ id, access }) => ({ id, access })),
      ).toEqual([
        { id: "chatgpt:default", access: "required" },
        { id: "newapi:default", access: "required" },
      ]);
    },
  );

  test("is byte-equivalent when normalized V5 state is migrated again", () => {
    const first = migrateLegacyStorage(
      legacyInput({ aiLimitsState: releasedState([releasedProvider("chatgpt")]) }),
      now,
      {},
    );
    const second = migrateLegacyStorage(
      {
        aiLimitsState: first.state,
        aiLimitsCredentials: first.credentialState,
        aiLimitsConnectionSuppressions: [],
      },
      now + day,
      {},
    );

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("drops orphan V2 credentials when validating an existing V5 cutover", () => {
    const result = migrateLegacyStorage(
      {
        aiLimitsState: {
          version: 5,
          preferences: { displayMode: "used", autoRefresh: true },
          instances: [],
        },
        aiLimitsCredentials: {
          version: 2,
          credentials: {
            "newapi:default": {
              kind: "api-key",
              value: "orphan-secret",
              status: "active",
              revision: "orphan-revision",
            },
          },
        },
      },
      now,
      {},
    );

    expect(result.credentialState).toEqual({ version: 2, credentials: {} });
  });

  test("adds a missing V5 binding but preserves an existing mismatch to fail closed", () => {
    const result = migrateLegacyStorage(
      {
        aiLimitsState: {
          version: 5,
          preferences: { displayMode: "used", autoRefresh: true },
          instances: [
            {
              id: "newapi:default",
              providerKind: "newapi",
              config: { kind: "dynamic-origin", baseUrl: "https://old.example" },
              access: "granted",
              createdAt: now,
              history: [],
              connectionRevision: "old-connection-revision",
            },
            {
              id: "elevenlabs:default",
              providerKind: "elevenlabs",
              config: { kind: "fixed" },
              access: "granted",
              createdAt: now,
              history: [],
            },
          ],
        },
        aiLimitsCredentials: {
          version: 2,
          credentials: {
            "newapi:default": {
              kind: "api-key",
              value: "replacement-secret",
              status: "active",
              revision: "replacement-revision",
            },
            "elevenlabs:default": {
              kind: "api-key",
              value: "existing-secret",
              status: "active",
              revision: "existing-revision",
            },
          },
        },
      },
      now,
      {},
    );

    expect(result.state.instances).toEqual([
      expect.objectContaining({
        id: "newapi:default",
        connectionRevision: "old-connection-revision",
      }),
      expect.objectContaining({
        id: "elevenlabs:default",
        connectionRevision: "existing-revision",
      }),
    ]);
  });
});

describe("coordinated storage migration", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await browser.storage.local.clear();
  });

  test("reads all released keys and atomically writes V5 state plus V2 credentials before suppression cleanup", async () => {
    await browser.storage.local.set(
      legacyInput({
        aiLimitsState: releasedState([releasedProvider("chatgpt")]),
        aiLimitsConnectionSuppressions: ["claude"],
      }),
    );
    const get = vi.spyOn(browser.storage.local, "get");
    const set = vi.spyOn(browser.storage.local, "set");
    const remove = vi.spyOn(browser.storage.local, "remove");

    const result = await migrateLegacyStorageInPlace(now, {});

    expect(get).toHaveBeenCalledWith([
      "aiLimitsState",
      "aiLimitsCredentials",
      "aiLimitsConnectionSuppressions",
    ]);
    expect(set).toHaveBeenCalledWith({
      aiLimitsState: result.state,
      aiLimitsCredentials: result.credentialState,
    });
    expect(remove).toHaveBeenCalledWith("aiLimitsConnectionSuppressions");
    expect(set.mock.invocationCallOrder.at(-1)).toBeLessThan(
      remove.mock.invocationCallOrder.at(-1)!,
    );
  });

  test("leaves legacy suppression intact when the atomic V5 write fails", async () => {
    const input = legacyInput({ aiLimitsConnectionSuppressions: ["claude"] });
    await browser.storage.local.set(input);
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(async (value) => {
      if ((value as Record<string, unknown>).aiLimitsState !== undefined) {
        throw new Error("storage unavailable");
      }
      return storageSet(value);
    });

    await expect(migrateLegacyStorageInPlace(now, {})).rejects.toThrow(
      "storage unavailable",
    );
    await expect(
      browser.storage.local.get("aiLimitsConnectionSuppressions"),
    ).resolves.toEqual({ aiLimitsConnectionSuppressions: ["claude"] });
  });

  test("reruns byte-equivalently after interruption between atomic cutover and legacy cleanup", async () => {
    await browser.storage.local.set(
      legacyInput({
        aiLimitsState: releasedState([releasedProvider("chatgpt")]),
        aiLimitsConnectionSuppressions: ["claude"],
      }),
    );
    const remove = vi
      .spyOn(browser.storage.local, "remove")
      .mockRejectedValueOnce(new Error("service worker interrupted"));

    await expect(migrateLegacyStorageInPlace(now, {})).rejects.toThrow(
      "service worker interrupted",
    );
    const afterInterruptedCutover = await browser.storage.local.get([
      "aiLimitsState",
      "aiLimitsCredentials",
    ]);
    await expect(
      browser.storage.local.get("aiLimitsConnectionSuppressions"),
    ).resolves.toEqual({ aiLimitsConnectionSuppressions: ["claude"] });

    await migrateLegacyStorageInPlace(now + day, {});

    await expect(
      browser.storage.local.get(["aiLimitsState", "aiLimitsCredentials"]),
    ).resolves.toEqual(afterInterruptedCutover);
    await expect(
      browser.storage.local.get("aiLimitsConnectionSuppressions"),
    ).resolves.toEqual({});
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
