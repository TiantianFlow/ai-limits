import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/instances";
import type { CollectionResult, ProviderPackage } from "../providers/types";
import { providerRegistry } from "../providers/registry";
import {
  initializeCredentialVault,
  readCredentialWithRevision,
  saveApiKeyIfCurrent,
} from "../storage/credential-vault";
import {
  connectionRepository,
  loadInstanceAppState,
} from "../storage/instance-repository";
import { createProviderService } from "./provider-service";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";

function newApiInstance(
  id: ProviderInstanceId,
  baseUrl = "https://relay.example",
): ProviderInstanceRecord {
  return {
    id,
    providerKind: "newapi",
    config: { kind: "dynamic-origin", baseUrl },
    access: "granted",
    createdAt: NOW,
    history: [],
  };
}

function success(
  providerKind: ProviderInstanceRecord["providerKind"],
  fetchedAt = NOW,
): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind,
      source: providerKind === "newapi" ? "api-key" : "web-session",
      fetchedAt,
      metrics: [
        {
          type: "quota",
          id: "primary",
          label: "Primary",
          scope: "general",
          usedRatio: 0.25,
        },
      ],
    },
  };
}

function registryWith(overrides: Partial<Record<string, ProviderPackage>>) {
  return { ...providerRegistry, ...overrides } as typeof providerRegistry;
}

async function seed(instance: ProviderInstanceRecord, apiKey?: string) {
  await connectionRepository.create(instance);
  if (apiKey) {
    const result = await saveApiKeyIfCurrent(instance.id, apiKey, () => true);
    expect(result.saved).toBe(true);
  }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialVault();
  vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
});

describe("generic provider instance service", () => {
  test("refreshes only the selected same-kind sibling with its own credential and state", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    await seed(newApiInstance(SECOND), "second-secret");
    const collect = vi.fn(async () => success("newapi"));
    const service = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });

    const report = await service.refreshInstance(FIRST, "manual_provider");

    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ id: FIRST }),
      expect.anything(),
      { kind: "api-key", value: "first-secret" },
    );
    expect(report.results).toEqual([
      { instanceId: FIRST, outcome: expect.objectContaining({ kind: "success" }) },
    ]);
    const state = await loadInstanceAppState();
    expect(state.instances.find(({ id }) => id === FIRST)?.history).toHaveLength(1);
    expect(state.instances.find(({ id }) => id === SECOND)?.history).toHaveLength(0);
    await expect(readCredentialWithRevision(SECOND)).resolves.toMatchObject({
      value: "second-secret",
      status: "active",
    });
  });

  test("refresh-all enumerates active instances in durable order", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    await seed(newApiInstance(SECOND), "second-secret");
    const collect = vi.fn(async (instance: ProviderInstanceRecord) =>
      success(instance.providerKind),
    );
    const service = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });

    const report = await service.refreshAll("manual_all");

    expect(report.results.map(({ instanceId }) => instanceId)).toEqual([FIRST, SECOND]);
    expect(collect.mock.calls.map(([instance]) => instance.id)).toEqual([FIRST, SECOND]);
  });

  test("credential rejection marks only the selected instance revision", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    await seed(newApiInstance(SECOND), "second-secret");
    const collect = vi.fn(async (instance: ProviderInstanceRecord) =>
      instance.id === FIRST
        ? ({ ok: false, health: { kind: "credential_invalid" } } as const)
        : success("newapi"),
    );
    const service = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });

    await service.refreshInstance(FIRST, "manual_provider");

    await expect(readCredentialWithRevision(FIRST)).resolves.toMatchObject({
      value: "first-secret",
      status: "rejected",
    });
    await expect(readCredentialWithRevision(SECOND)).resolves.toMatchObject({
      value: "second-secret",
      status: "active",
    });
  });

  test("a superseded singleton connect cannot overwrite the newer credential or state", async () => {
    let enteredFirstCreate: (() => void) | undefined;
    let releaseFirstCreate: (() => void) | undefined;
    const firstCreateEntered = new Promise<void>((resolve) => {
      enteredFirstCreate = resolve;
    });
    const firstCreateRelease = new Promise<void>((resolve) => {
      releaseFirstCreate = resolve;
    });
    const originalCreateIfCurrent =
      connectionRepository.createIfCurrent.bind(connectionRepository);
    vi.spyOn(connectionRepository, "createIfCurrent")
      .mockImplementationOnce(async (candidate, isCurrent) => {
        enteredFirstCreate?.();
        await firstCreateRelease;
        return originalCreateIfCurrent(candidate, isCurrent);
      });
    const collect = vi.fn(async () => success("elevenlabs"));
    const service = createProviderService({
      packages: registryWith({
        elevenlabs: { ...providerRegistry.elevenlabs, collect },
      }),
      clock: () => NOW,
    });

    const first = service.connectApiKeyProvider({
      providerKind: "elevenlabs",
      config: { kind: "fixed" },
      apiKey: "first-secret",
    });
    await firstCreateEntered;
    const second = service.connectApiKeyProvider({
      providerKind: "elevenlabs",
      config: { kind: "fixed" },
      apiKey: "second-secret",
    });
    await expect(second).resolves.toMatchObject({ result: "connected" });
    releaseFirstCreate?.();

    await expect(first).resolves.toMatchObject({
      result: "temporary_error",
      report: {
        results: [
          {
            instanceId: "elevenlabs:default",
            outcome: { kind: "skipped", reason: "superseded" },
          },
        ],
      },
    });
    await expect(
      readCredentialWithRevision("elevenlabs:default"),
    ).resolves.toMatchObject({ value: "second-secret", status: "active" });
    expect(
      (await connectionRepository.get("elevenlabs:default"))?.history,
    ).toHaveLength(1);
  });

  test("delete-all invalidates an uncommitted new instance before local state can reappear", async () => {
    let enteredCreate: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    const createEntered = new Promise<void>((resolve) => {
      enteredCreate = resolve;
    });
    const createRelease = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const originalCreateIfCurrent =
      connectionRepository.createIfCurrent.bind(connectionRepository);
    vi.spyOn(connectionRepository, "createIfCurrent").mockImplementationOnce(
      async (candidate, isCurrent) => {
        enteredCreate?.();
        await createRelease;
        return originalCreateIfCurrent(candidate, isCurrent);
      },
    );
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);
    const service = createProviderService({
      packages: registryWith({
        newapi: {
          ...providerRegistry.newapi,
          collect: vi.fn(async () => success("newapi")),
        },
      }),
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440000",
    });

    const connection = service.connectApiKeyProvider({
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: "candidate-secret",
    });
    await createEntered;
    vi.mocked(browser.permissions.contains).mockResolvedValue(false as never);
    await expect(service.deleteAllLocalData()).resolves.toEqual({
      result: "deleted",
    });
    releaseCreate?.();

    await expect(connection).resolves.toMatchObject({
      result: "temporary_error",
      report: {
        results: [
          {
            instanceId: FIRST,
            outcome: { kind: "skipped", reason: "superseded" },
          },
        ],
      },
    });
    await expect(loadInstanceAppState()).resolves.toMatchObject({ instances: [] });
    await expect(readCredentialWithRevision(FIRST)).resolves.toBeUndefined();
  });

  test("failed API-key validation removes an exact grant with no instance owner", async () => {
    let permissionPresent = true;
    vi.mocked(browser.permissions.contains).mockImplementation(
      async () => permissionPresent as never,
    );
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(async () => {
        permissionPresent = false;
        return true as never;
      });
    const service = createProviderService({
      packages: registryWith({
        newapi: {
          ...providerRegistry.newapi,
          collect: vi.fn(async () => ({
            ok: false as const,
            health: { kind: "credential_invalid" as const },
          })),
        },
      }),
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440000",
    });

    await expect(
      service.connectApiKeyProvider({
        providerKind: "newapi",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
        apiKey: "invalid-secret",
      }),
    ).resolves.toMatchObject({ result: "invalid_key" });

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
    expect((await connectionRepository.list())).toEqual([]);
    await expect(readCredentialWithRevision(FIRST)).resolves.toBeUndefined();
  });

  test("failed API-key validation preserves a same-origin sibling grant", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    const remove = vi.spyOn(browser.permissions, "remove");
    const service = createProviderService({
      packages: registryWith({
        newapi: {
          ...providerRegistry.newapi,
          collect: vi.fn(async () => ({
            ok: false as const,
            health: { kind: "credential_invalid" as const },
          })),
        },
      }),
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440001",
    });

    await expect(
      service.connectApiKeyProvider({
        providerKind: "newapi",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
        apiKey: "invalid-secret",
      }),
    ).resolves.toMatchObject({ result: "invalid_key" });

    expect(remove).not.toHaveBeenCalled();
    await expect(connectionRepository.get(FIRST)).resolves.toBeDefined();
  });

  test("disconnect deletes local credential, state, and history before shared permission cleanup", async () => {
    await seed({
      ...newApiInstance(FIRST),
      history: [{ observedAt: NOW, metrics: [{ type: "quota", metricId: "primary", usedRatio: 0.2 }] }],
    }, "first-secret");
    await seed(newApiInstance(SECOND), "second-secret");
    const remove = vi.spyOn(browser.permissions, "remove");
    const service = createProviderService({ clock: () => NOW });

    await expect(service.disconnectInstance(FIRST)).resolves.toEqual({
      ok: true,
      localDataDeleted: true,
    });

    expect(remove).not.toHaveBeenCalled();
    await expect(readCredentialWithRevision(FIRST)).resolves.toBeUndefined();
    await expect(readCredentialWithRevision(SECOND)).resolves.toMatchObject({
      value: "second-secret",
    });
    expect((await loadInstanceAppState()).instances.map(({ id }) => id)).toEqual([SECOND]);
  });

  test("disconnecting the last owner removes its exact origin after local deletion", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    const events: string[] = [];
    const originalSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(async (items) => {
      events.push("local");
      return originalSet(items);
    });
    vi.mocked(browser.permissions.contains).mockResolvedValue(false as never);
    vi.spyOn(browser.permissions, "remove").mockImplementation(async () => {
      events.push("permission");
      expect(await readCredentialWithRevision(FIRST)).toBeUndefined();
      expect((await loadInstanceAppState()).instances).toHaveLength(0);
      return true as never;
    });
    const service = createProviderService({ clock: () => NOW });

    await expect(service.disconnectInstance(FIRST)).resolves.toEqual({
      ok: true,
      localDataDeleted: true,
    });

    expect(browser.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
    expect(events.at(-1)).toBe("permission");
  });

  test("external removal marks all owning siblings required without deleting their data", async () => {
    await seed({
      ...newApiInstance(FIRST),
      history: [{ observedAt: NOW, metrics: [{ type: "quota", metricId: "primary", usedRatio: 0.1 }] }],
    }, "first-secret");
    await seed({
      ...newApiInstance(SECOND),
      history: [{ observedAt: NOW, metrics: [{ type: "quota", metricId: "primary", usedRatio: 0.2 }] }],
    }, "second-secret");
    await seed({
      id: "kimi:default",
      providerKind: "kimi",
      config: { kind: "fixed" },
      access: "granted",
      createdAt: NOW,
      history: [{ observedAt: NOW, metrics: [{ type: "quota", metricId: "monthly", usedRatio: 0.3 }] }],
    });
    vi.mocked(browser.permissions.contains).mockImplementation(
      async (permissions) =>
        Boolean(permissions.origins?.includes("https://www.kimi.com/*")) as never,
    );
    const service = createProviderService({ clock: () => NOW });

    await service.reconcilePermissions({ origins: ["https://relay.example/*"] });

    const state = await loadInstanceAppState();
    expect(state.instances.find(({ id }) => id === FIRST)).toMatchObject({ access: "required", history: expect.any(Array) });
    expect(state.instances.find(({ id }) => id === SECOND)).toMatchObject({ access: "required", history: expect.any(Array) });
    expect(state.instances.find(({ id }) => id === "kimi:default")).toMatchObject({
      access: "granted",
      history: expect.any(Array),
    });
    expect(state.instances.every(({ history }) => history.length === 1)).toBe(true);
    await expect(readCredentialWithRevision(FIRST)).resolves.toMatchObject({ value: "first-secret" });
    await expect(readCredentialWithRevision(SECOND)).resolves.toMatchObject({ value: "second-secret" });
  });

  test("external removal leaves an unrelated instance unchanged", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    await seed({
      id: "kimi:default",
      providerKind: "kimi",
      config: { kind: "fixed" },
      access: "required",
      createdAt: NOW,
      history: [],
    });
    vi.mocked(browser.permissions.contains).mockImplementation(
      async (permissions) =>
        Boolean(permissions.origins?.includes("https://www.kimi.com/*")) as never,
    );
    const service = createProviderService({ clock: () => NOW });

    await service.reconcilePermissions({ origins: ["https://relay.example/*"] });

    expect(
      (await connectionRepository.get("kimi:default"))?.access,
    ).toBe("required");
  });

  test("external removal invalidates owning work before permission reconciliation waits", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
    let activeSignal: AbortSignal | undefined;
    const collect = vi.fn(
      async (
        _instance: ProviderInstanceRecord,
        services: { signal: AbortSignal },
      ) => {
        activeSignal = services.signal;
        return new Promise<CollectionResult>(() => undefined);
      },
    );
    const service = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });
    const refresh = service.refreshInstance(FIRST, "manual_provider");
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    let resolveContains: ((value: boolean) => void) | undefined;
    vi.mocked(browser.permissions.contains).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveContains = resolve;
        }) as never,
    );

    const reconciliation = service.reconcilePermissions({
      origins: ["https://relay.example/*"],
    });

    await vi.waitFor(() => expect(activeSignal?.aborted).toBe(true));
    resolveContains?.(false);
    await reconciliation;
    await expect(refresh).resolves.toMatchObject({
      results: [
        {
          instanceId: FIRST,
          outcome: { kind: "skipped", reason: "superseded" },
        },
      ],
    });
  });

  test("permission-only browser connect creates one singleton instance", async () => {
    const collect = vi.fn(async () => success("chatgpt"));
    const service = createProviderService({
      packages: registryWith({ chatgpt: { ...providerRegistry.chatgpt, collect } }),
      clock: () => NOW,
    });

    await service.connectBrowserProvider("chatgpt");
    await service.connectBrowserProvider("chatgpt");

    const instances = (await loadInstanceAppState()).instances;
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      id: "chatgpt:default",
      providerKind: "chatgpt",
      access: "granted",
    });
  });

  test("scheduled Kimi collection is noninteractive", async () => {
    await seed({
      id: "kimi:default",
      providerKind: "kimi",
      config: { kind: "fixed" },
      access: "granted",
      createdAt: NOW,
      history: [],
    });
    const collect = vi.fn(async () => success("kimi"));
    const service = createProviderService({
      packages: registryWith({ kimi: { ...providerRegistry.kimi, collect } }),
      clock: () => NOW,
    });

    await service.refreshAll("scheduled");

    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "kimi:default" }),
      expect.objectContaining({ interaction: "forbidden" }),
      undefined,
    );
  });
});
