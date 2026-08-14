import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../domain/instances";

type InstanceRepository = typeof import("./instance-repository");

const now = Date.parse("2030-05-01T12:00:00.000Z");
const hour = 60 * 60 * 1_000;

let repository: InstanceRepository;

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
    createdAt: now,
    history: [],
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await browser.storage.local.clear();
  vi.spyOn(Date, "now").mockReturnValue(now);
  repository = await import("./instance-repository");
});

describe("queued instance repositories", () => {
  test("starts with an empty V5 state", async () => {
    await expect(repository.loadInstanceAppState()).resolves.toEqual({
      version: 5,
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [],
    });
  });

  test("serializes concurrent creation of same-origin New API siblings", async () => {
    const personal = newApiInstance(
      "newapi:550e8400-e29b-41d4-a716-446655440000",
      "Personal relay",
    );
    const work = newApiInstance(
      "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
      "Work relay",
    );

    await Promise.all([
      repository.connectionRepository.create(personal),
      repository.connectionRepository.create(work),
    ]);

    await expect(repository.connectionRepository.list()).resolves.toEqual([
      personal,
      work,
    ]);
    await expect(repository.connectionRepository.get(work.id)).resolves.toEqual(
      work,
    );
  });

  test("rejects duplicate IDs and singleton cardinality without leaking config", async () => {
    const chatgpt: ProviderInstanceRecord = {
      id: "chatgpt:default",
      providerKind: "chatgpt",
      config: { kind: "fixed" },
      access: "granted",
      createdAt: now,
      history: [],
    };
    await repository.connectionRepository.create(chatgpt);

    await expect(
      repository.connectionRepository.create({
        ...chatgpt,
        userLabel: "Duplicate ID",
      }),
    ).rejects.not.toThrow(/chatgpt:default/);
    await expect(
      repository.connectionRepository.create({
        ...chatgpt,
        id: "chatgpt:550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.not.toThrow(/chatgpt:550e8400/);
    await expect(repository.connectionRepository.list()).resolves.toEqual([
      chatgpt,
    ]);
  });

  test("renames and changes access while preserving immutable identity and config", async () => {
    const instance = newApiInstance("newapi:default", "Old label");
    await repository.connectionRepository.create(instance);

    await repository.connectionRepository.rename(instance.id, "  New label  ");
    await repository.connectionRepository.setAccess(instance.id, "required");
    await expect(repository.connectionRepository.get(instance.id)).resolves.toEqual({
      ...instance,
      userLabel: "New label",
      access: "required",
    });

    await repository.connectionRepository.rename(instance.id, "   ");
    await expect(repository.connectionRepository.get(instance.id)).resolves.toEqual({
      id: instance.id,
      providerKind: instance.providerKind,
      config: instance.config,
      access: "required",
      createdAt: instance.createdAt,
      history: [],
    });
  });

  test("re-reads and normalizes raw state inside a mutation", async () => {
    const instance = newApiInstance("newapi:default", "Before");
    await repository.connectionRepository.create(instance);
    await browser.storage.local.set({
      aiLimitsState: {
        version: 5,
        preferences: { displayMode: "invalid", autoRefresh: "yes" },
        instances: [
          instance,
          { ...instance, userLabel: "duplicate raw record" },
          { apiKey: "synthetic-secret" },
        ],
      },
    });

    await repository.connectionRepository.rename(instance.id, "After");

    await expect(repository.loadInstanceAppState()).resolves.toEqual({
      version: 5,
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [{ ...instance, userLabel: "After" }],
    });
    expect(JSON.stringify(await browser.storage.local.get("aiLimitsState")))
      .not.toContain("synthetic-secret");
  });

  test("commits usage but prevents an updater from changing identity, kind, or config", async () => {
    const instance = newApiInstance("newapi:default", "Personal relay");
    await repository.connectionRepository.create(instance);

    await expect(
      repository.usageRepository.commit(instance.id, (current) => ({
        ...current,
        id: "newapi:550e8400-e29b-41d4-a716-446655440000",
        providerKind: "chatgpt",
        config: { kind: "fixed" },
        snapshot: {
          providerKind: "newapi",
          source: "api-key",
          fetchedAt: now,
          metrics: [
            {
              type: "counter",
              id: "relay-key-usage",
              label: "API key usage",
              scope: "product",
              semantic: "consumed",
              value: 42,
              unit: "quota units",
            },
          ],
        },
        history: [
          {
            observedAt: now,
            metrics: [
              {
                type: "counter",
                metricId: "relay-key-usage",
                semantic: "consumed",
                value: 42,
                unit: "quota units",
              },
            ],
          },
        ],
        lastAttempt: {
          trigger: "manual_provider",
          startedAt: now - 1_000,
          finishedAt: now,
          outcome: { kind: "success" },
        },
      })),
    ).resolves.toBe(true);

    await expect(repository.connectionRepository.get(instance.id)).resolves.toEqual({
      ...instance,
      snapshot: expect.objectContaining({
        providerKind: "newapi",
        metrics: [expect.objectContaining({ type: "counter", value: 42 })],
      }),
      history: [
        expect.objectContaining({
          metrics: [expect.objectContaining({ type: "counter", value: 42 })],
        }),
      ],
      lastAttempt: expect.objectContaining({ outcome: { kind: "success" } }),
    });
  });

  test("returns false for missing usage targets and clears one instance's usage", async () => {
    const instance = newApiInstance("newapi:default", "Personal relay");
    instance.snapshot = {
      providerKind: "newapi",
      source: "api-key",
      fetchedAt: now,
      metrics: [
        {
          type: "quota",
          id: "relay-key-quota",
          label: "API key quota",
          scope: "product",
          usedRatio: 0.5,
        },
      ],
    };
    instance.history = [
      {
        observedAt: now - hour,
        metrics: [
          { type: "quota", metricId: "relay-key-quota", usedRatio: 0.4 },
        ],
      },
    ];
    instance.lastAttempt = {
      trigger: "scheduled",
      startedAt: now - 1_000,
      finishedAt: now,
      outcome: { kind: "success" },
    };
    await repository.connectionRepository.create(instance);

    await expect(
      repository.usageRepository.commit("newapi:missing", (current) => current),
    ).resolves.toBe(false);
    await repository.usageRepository.clear(instance.id);
    await expect(repository.connectionRepository.get(instance.id)).resolves.toEqual({
      id: instance.id,
      providerKind: instance.providerKind,
      userLabel: instance.userLabel,
      config: instance.config,
      access: instance.access,
      createdAt: instance.createdAt,
      history: [],
    });
  });

  test("updates preferences and deletes instances independently", async () => {
    const first = newApiInstance(
      "newapi:550e8400-e29b-41d4-a716-446655440000",
      "Personal relay",
    );
    const second = newApiInstance(
      "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
      "Work relay",
    );
    await repository.connectionRepository.create(first);
    await repository.connectionRepository.create(second);

    await repository.preferencesRepository.setDisplayMode("left");
    await repository.preferencesRepository.setAutoRefresh(false);
    await repository.connectionRepository.delete(first.id);

    await expect(repository.loadInstanceAppState()).resolves.toEqual({
      version: 5,
      preferences: { displayMode: "left", autoRefresh: false },
      instances: [second],
    });
  });

  test("deletes all V5 instance data without touching credential or unrelated keys", async () => {
    await browser.storage.local.set({
      unrelated: "keep",
      aiLimitsCredentials: {
        version: 2,
        credentials: {
          "newapi:default": {
            kind: "api-key",
            value: "synthetic-secret",
            status: "active",
            revision: "revision",
          },
        },
      },
    });
    await repository.connectionRepository.create(
      newApiInstance("newapi:default", "Personal relay"),
    );

    await expect(repository.deleteAllInstanceData()).resolves.toEqual({
      version: 5,
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [],
    });
    await expect(browser.storage.local.get("unrelated")).resolves.toEqual({
      unrelated: "keep",
    });
    await expect(browser.storage.local.get("aiLimitsCredentials"))
      .resolves.toHaveProperty(
        "aiLimitsCredentials.credentials.newapi:default.value",
        "synthetic-secret",
      );
  });
});
