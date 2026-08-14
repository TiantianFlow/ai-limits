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
import { migrateLegacyStorageInPlace } from "../storage/migration";
import {
  createProviderService,
  type ConnectApiKeyProviderRequest,
  type ProviderService,
} from "./provider-service";

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
    if (!result.saved) throw new Error("fixture save failed");
    await connectionRepository.replace(instance.id, (current) => ({
      ...current,
      connectionRevision: result.revision,
    }));
  }
}

async function authorizedApiRequest(
  service: ProviderService,
  request: Omit<ConnectApiKeyProviderRequest, "permissionIntentId">,
): Promise<ConnectApiKeyProviderRequest> {
  const prepared = await service.prepareProviderPermission({
    providerKind: request.providerKind,
    ...(request.instanceId ? { instanceId: request.instanceId } : {}),
    ...(Object.hasOwn(request, "userLabel")
      ? { userLabel: request.userLabel }
      : {}),
    config: request.config,
  });
  await service.resolveProviderPermission(prepared.permissionIntentId, true);
  return { ...request, permissionIntentId: prepared.permissionIntentId };
}

async function authorizedBrowserIntent(
  service: ProviderService,
  providerKind: "chatgpt",
): Promise<string> {
  const prepared = await service.prepareProviderPermission({
    providerKind,
    config: { kind: "fixed" },
  });
  await service.resolveProviderPermission(prepared.permissionIntentId, true);
  return prepared.permissionIntentId;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialVault();
  vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
});

describe("generic provider instance service", () => {
  test("registers a non-secret exact permission intent before API connection", async () => {
    const service = createProviderService({
      clock: () => NOW,
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440099")
        .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440000"),
    });

    const prepared = await service.prepareProviderPermission({
      providerKind: "newapi",
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://relay.example/gateway/v1/messages",
      },
    });

    expect(prepared).toEqual({
      permissionIntentId: "550e8400-e29b-41d4-a716-446655440000",
      instanceId: "newapi:550e8400-e29b-41d4-a716-446655440099",
      permissions: { origins: ["https://relay.example/*"] },
    });
    expect(await browser.storage.session.get(null)).toEqual({});
    expect(JSON.stringify(await browser.storage.local.get(null))).not.toMatch(
      /apiKey|credential|secret|revision|lease/i,
    );
  });

  test("keeps a same-origin pending owner through sibling disconnect, then removes the orphan on abandon", async () => {
    await seed(newApiInstance(FIRST), "first-secret");
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
      clock: () => NOW,
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440001")
        .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440099"),
    });
    const prepared = await service.prepareProviderPermission({
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
    });

    await service.disconnectInstance(FIRST);
    expect(remove).not.toHaveBeenCalled();

    await service.abandonProviderPermission(prepared.permissionIntentId);
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
  });

  test("prepares exact Kimi origin, cookie, and scripting permission ownership", async () => {
    const service = createProviderService({
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
    });

    await expect(
      service.prepareProviderPermission({
        providerKind: "kimi",
        config: { kind: "fixed" },
      }),
    ).resolves.toMatchObject({
      instanceId: "kimi:default",
      permissions: {
        origins: ["https://www.kimi.com/*"],
        permissions: ["cookies", "scripting"],
      },
    });
  });

  test("sweeps an abandoned worker-lifetime intent and removes its exact orphan grant", async () => {
    let now = NOW;
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
      clock: () => now,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
      permissionIntentTtlMs: 100,
    });
    await service.prepareProviderPermission({
      providerKind: "kimi",
      config: { kind: "fixed" },
    });

    now += 101;
    await service.sweepPermissionIntents();

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://www.kimi.com/*"],
      permissions: ["cookies", "scripting"],
    });
    expect(JSON.stringify(await browser.storage.local.get(null))).not.toContain(
      "kimi:default",
    );
  });

  test.each(["returns false", "throws"])(
    "retains failed permission cleanup when remove %s and retries it after browser restart",
    async (failureMode) => {
      let now = NOW;
      let permissionPresent = true;
      vi.mocked(browser.permissions.contains).mockImplementation(
        async () => permissionPresent as never,
      );
      const remove = vi
        .spyOn(browser.permissions, "remove")
        .mockImplementationOnce(async () => {
          if (failureMode === "throws") throw new Error("remove unavailable");
          return false as never;
        })
        .mockImplementationOnce(async () => {
          permissionPresent = false;
          return true as never;
        });
      const service = createProviderService({
        clock: () => now,
        randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
        permissionIntentTtlMs: 100,
      });
      await service.prepareProviderPermission({
        providerKind: "newapi",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      });

      now += 101;
      await service.sweepPermissionIntents();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await browser.storage.local.get(null))).toContain(
        "aiLimitsPermissionIntents",
      );

      await browser.storage.session.clear();
      const restarted = createProviderService({ clock: () => now + 1 });
      await restarted.sweepPermissionIntents();
      expect(remove).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(await browser.storage.local.get(null))).not.toContain(
        "newapi:550e8400-e29b-41d4-a716-446655440099",
      );
    },
  );

  test("surfaces cleanup alarm failure after persisting restart-retry evidence", async () => {
    let now = NOW;
    const service = createProviderService({
      clock: () => now,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
      permissionIntentTtlMs: 100,
    });
    await service.prepareProviderPermission({
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
    });
    now += 101;
    vi.spyOn(browser.alarms, "create").mockRejectedValueOnce(
      new Error("alarm unavailable"),
    );

    await expect(service.sweepPermissionIntents()).rejects.toThrow(
      "alarm unavailable",
    );
    const durable = JSON.stringify(await browser.storage.local.get(null));
    expect(durable).toContain("aiLimitsPermissionIntents");
    expect(durable).toContain("cleanup-pending");
    expect(durable).not.toMatch(/apiKey|secret|credential/i);

    vi.restoreAllMocks();
    let permissionPresent = true;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async () => permissionPresent as never,
    );
    const remove = vi.spyOn(browser.permissions, "remove").mockImplementation(
      async () => {
        permissionPresent = false;
        return true as never;
      },
    );
    await browser.storage.session.clear();
    const restarted = createProviderService({ clock: () => now });
    await restarted.sweepPermissionIntents();
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
    expect(JSON.stringify(await browser.storage.local.get(null))).not.toContain(
      "newapi:550e8400-e29b-41d4-a716-446655440099",
    );
  });

  test("never leaves a committed API instance granted when authority disappears during its commit", async () => {
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
    const request = await authorizedApiRequest(service, {
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: "candidate-secret",
    });
    vi.mocked(browser.permissions.contains)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValue(false as never);

    await expect(service.connectApiKeyProvider(request)).resolves.toMatchObject({
      result: "temporary_error",
    });
    await expect(connectionRepository.get(FIRST)).resolves.toMatchObject({
      access: "required",
    });
  });

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

  test("serializes same-instance replacement commits so the later singleton generation wins intact", async () => {
    await seed({
      id: "elevenlabs:default",
      providerKind: "elevenlabs",
      config: { kind: "fixed" },
      access: "granted",
      createdAt: NOW,
      history: [],
    }, "old-secret");
    let enteredFirstReplace: (() => void) | undefined;
    let releaseFirstReplace: (() => void) | undefined;
    const firstReplaceEntered = new Promise<void>((resolve) => {
      enteredFirstReplace = resolve;
    });
    const firstReplaceRelease = new Promise<void>((resolve) => {
      releaseFirstReplace = resolve;
    });
    const originalReplace = connectionRepository.replace.bind(connectionRepository);
    vi.spyOn(connectionRepository, "replace")
      .mockImplementationOnce(async (instanceId, updater) => {
        enteredFirstReplace?.();
        await firstReplaceRelease;
        return originalReplace(instanceId, updater);
      });
    const collect = vi.fn(async () => success("elevenlabs"));
    const service = createProviderService({
      packages: registryWith({
        elevenlabs: { ...providerRegistry.elevenlabs, collect },
      }),
      clock: () => NOW,
    });

    const firstRequest = await authorizedApiRequest(service, {
      providerKind: "elevenlabs",
      instanceId: "elevenlabs:default",
      config: { kind: "fixed" },
      apiKey: "first-secret",
    });
    const secondRequest = await authorizedApiRequest(service, {
      providerKind: "elevenlabs",
      instanceId: "elevenlabs:default",
      config: { kind: "fixed" },
      apiKey: "second-secret",
    });
    const first = service.connectApiKeyProvider(firstRequest);
    await firstReplaceEntered;
    const second = service.connectApiKeyProvider(secondRequest);
    await Promise.resolve();
    releaseFirstReplace?.();

    await expect(first).resolves.toMatchObject({ result: "connected" });
    await expect(second).resolves.toMatchObject({ result: "connected" });
    await expect(
      readCredentialWithRevision("elevenlabs:default"),
    ).resolves.toMatchObject({ value: "second-secret", status: "active" });
    expect(
      (await connectionRepository.get("elevenlabs:default"))?.history,
    ).toHaveLength(1);
  });

  test("does not pair an older credential with a superseded replacement config when state storage pauses", async () => {
    await seed(newApiInstance(FIRST, "https://old.example/gateway"), "old-secret");
    let enteredFirstStateWrite: (() => void) | undefined;
    let releaseFirstStateWrite: (() => void) | undefined;
    const firstStateWriteEntered = new Promise<void>((resolve) => {
      enteredFirstStateWrite = resolve;
    });
    const firstStateWriteRelease = new Promise<void>((resolve) => {
      releaseFirstStateWrite = resolve;
    });
    const originalSet = browser.storage.local.set.bind(browser.storage.local);
    let paused = false;
    vi.spyOn(browser.storage.local, "set").mockImplementation(async (items) => {
      const state = (items as Record<string, unknown>).aiLimitsState as
        | { instances?: ProviderInstanceRecord[] }
        | undefined;
      if (
        !paused &&
        state?.instances?.some(
          ({ config }) =>
            config.kind === "dynamic-origin" &&
            config.baseUrl === "https://first.example/gateway",
        )
      ) {
        paused = true;
        enteredFirstStateWrite?.();
        await firstStateWriteRelease;
      }
      return originalSet(items);
    });
    const collect = vi.fn(async (instance: ProviderInstanceRecord) =>
      instance.config.kind === "dynamic-origin" &&
      instance.config.baseUrl === "https://second.example/gateway"
        ? ({ ok: false, health: { kind: "credential_invalid" } } as const)
        : success("newapi"),
    );
    const service = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });

    const firstRequest = await authorizedApiRequest(service, {
      providerKind: "newapi",
      instanceId: FIRST,
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://first.example/gateway",
      },
      apiKey: "first-secret",
    });
    const secondRequest = await authorizedApiRequest(service, {
      providerKind: "newapi",
      instanceId: FIRST,
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://second.example/gateway",
      },
      apiKey: "second-secret",
    });
    const first = service.connectApiKeyProvider(firstRequest);
    await firstStateWriteEntered;
    const second = service.connectApiKeyProvider(secondRequest);
    await Promise.resolve();
    releaseFirstStateWrite?.();
    await expect(first).resolves.toMatchObject({ result: "connected" });
    await expect(second).resolves.toMatchObject({ result: "invalid_key" });

    await expect(connectionRepository.get(FIRST)).resolves.toMatchObject({
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://first.example/gateway",
      },
    });
    await expect(readCredentialWithRevision(FIRST)).resolves.toMatchObject({
      value: "first-secret",
      status: "active",
    });

    collect.mockClear();
    await service.refreshInstance(FIRST, "manual_provider");
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: FIRST,
        config: {
          kind: "dynamic-origin",
          baseUrl: "https://first.example/gateway",
        },
      }),
      expect.anything(),
      { kind: "api-key", value: "first-secret" },
    );
  });

  test("cleans the authoritative prior origin after overlapping replacements read stale state", async () => {
    await seed(newApiInstance(FIRST, "https://old.example/gateway"), "old-secret");
    const oldInstance = await connectionRepository.get(FIRST);
    if (!oldInstance) throw new Error("missing old fixture");
    const grantedOrigins = new Set([
      "https://old.example/*",
      "https://first.example/*",
      "https://second.example/*",
    ]);
    vi.mocked(browser.permissions.contains).mockImplementation(
      async ({ origins }) =>
        (origins ?? []).every((origin) => grantedOrigins.has(origin)) as never,
    );
    const remove = vi.spyOn(browser.permissions, "remove").mockImplementation(
      async ({ origins }) => {
        for (const origin of origins ?? []) grantedOrigins.delete(origin);
        return true as never;
      },
    );
    const service = createProviderService({
      packages: registryWith({
        newapi: {
          ...providerRegistry.newapi,
          collect: vi.fn(async () => success("newapi")),
        },
      }),
      clock: () => NOW,
    });
    const firstRequest = await authorizedApiRequest(service, {
      providerKind: "newapi",
      instanceId: FIRST,
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://first.example/gateway",
      },
      apiKey: "first-secret",
    });
    const secondRequest = await authorizedApiRequest(service, {
      providerKind: "newapi",
      instanceId: FIRST,
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://second.example/gateway",
      },
      apiKey: "second-secret",
    });

    let staleReadEntered: (() => void) | undefined;
    let releaseStaleRead: (() => void) | undefined;
    const staleRead = new Promise<void>((resolve) => {
      staleReadEntered = resolve;
    });
    const staleReadRelease = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    vi.spyOn(connectionRepository, "get").mockImplementationOnce(async () => {
      staleReadEntered?.();
      await staleReadRelease;
      return oldInstance;
    });
    const second = service.connectApiKeyProvider(secondRequest);
    await staleRead;
    const first = service.connectApiKeyProvider(firstRequest);
    await expect(first).resolves.toMatchObject({ result: "connected" });
    releaseStaleRead?.();
    await expect(second).resolves.toMatchObject({ result: "connected" });

    await expect(connectionRepository.get(FIRST)).resolves.toMatchObject({
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://second.example/gateway",
      },
    });
    expect(grantedOrigins).toEqual(new Set(["https://second.example/*"]));
    expect(remove).toHaveBeenCalledWith({ origins: ["https://old.example/*"] });
    expect(remove).toHaveBeenCalledWith({ origins: ["https://first.example/*"] });
  });

  test("retries failed authoritative replacement cleanup after browser restart", async () => {
    await seed(newApiInstance(FIRST, "https://old.example/gateway"), "old-secret");
    const grantedOrigins = new Set([
      "https://old.example/*",
      "https://replacement.example/*",
    ]);
    vi.mocked(browser.permissions.contains).mockImplementation(
      async ({ origins }) =>
        (origins ?? []).every((origin) => grantedOrigins.has(origin)) as never,
    );
    const remove = vi
      .spyOn(browser.permissions, "remove")
      .mockResolvedValueOnce(false as never)
      .mockImplementationOnce(async ({ origins }) => {
        for (const origin of origins ?? []) grantedOrigins.delete(origin);
        return true as never;
      });
    const service = createProviderService({
      packages: registryWith({
        newapi: {
          ...providerRegistry.newapi,
          collect: vi.fn(async () => success("newapi")),
        },
      }),
      clock: () => NOW,
    });

    await expect(
      service.connectApiKeyProvider(
        await authorizedApiRequest(service, {
          providerKind: "newapi",
          instanceId: FIRST,
          config: {
            kind: "dynamic-origin",
            baseUrl: "https://replacement.example/gateway",
          },
          apiKey: "replacement-secret",
        }),
      ),
    ).resolves.toMatchObject({ result: "connected" });
    expect(grantedOrigins).toContain("https://old.example/*");
    expect(JSON.stringify(await browser.storage.local.get(null))).toContain(
      "https://old.example/gateway",
    );

    await browser.storage.session.clear();
    const restarted = createProviderService({ clock: () => NOW + 1 });
    await restarted.sweepPermissionIntents();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(grantedOrigins).toEqual(new Set(["https://replacement.example/*"]));
    expect(JSON.stringify(await browser.storage.local.get(null))).not.toContain(
      "https://old.example/gateway",
    );
  });

  test("fails closed after a crash between credential and config writes even when rollback also fails", async () => {
    const oldRevision = "550e8400-e29b-41d4-a716-446655440090";
    await browser.storage.local.set({
      aiLimitsState: {
        version: 5,
        preferences: { displayMode: "used", autoRefresh: true },
        instances: [
          {
            ...newApiInstance(FIRST, "https://old.example/gateway"),
            connectionRevision: oldRevision,
          },
        ],
      },
      aiLimitsCredentials: {
        version: 2,
        credentials: {
          [FIRST]: {
            kind: "api-key",
            value: "old-secret",
            status: "active",
            revision: oldRevision,
          },
        },
      },
    });
    const collect = vi.fn(async () => success("newapi"));
    const service = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });
    const request = await authorizedApiRequest(service, {
      providerKind: "newapi",
      instanceId: FIRST,
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://replacement.example/gateway",
      },
      apiKey: "replacement-secret",
    });
    const originalSet = browser.storage.local.set.bind(browser.storage.local);
    let stateWriteFailed = false;
    vi.spyOn(browser.storage.local, "set").mockImplementation(async (items) => {
      const record = items as Record<string, unknown>;
      if (record.aiLimitsState && !stateWriteFailed) {
        const state = record.aiLimitsState as { instances?: ProviderInstanceRecord[] };
        if (
          state.instances?.some(
            ({ config }) =>
              config.kind === "dynamic-origin" &&
              config.baseUrl === "https://replacement.example/gateway",
          )
        ) {
          stateWriteFailed = true;
          throw new Error("simulated state crash");
        }
      }
      if (stateWriteFailed && record.aiLimitsCredentials) {
        const state = record.aiLimitsCredentials as {
          credentials?: Record<string, { value?: string }>;
        };
        if (state.credentials?.[FIRST]?.value === "old-secret") {
          throw new Error("simulated rollback crash");
        }
      }
      return originalSet(items);
    });

    await expect(service.connectApiKeyProvider(request)).rejects.toThrow(
      "simulated rollback crash",
    );
    vi.restoreAllMocks();
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    await migrateLegacyStorageInPlace(NOW, {
      origins: ["https://old.example/*", "https://replacement.example/*"],
    });

    await expect(connectionRepository.get(FIRST)).resolves.toMatchObject({
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://old.example/gateway",
      },
      connectionRevision: oldRevision,
    });
    await expect(readCredentialWithRevision(FIRST)).resolves.toMatchObject({
      value: "replacement-secret",
      status: "active",
      revision: expect.not.stringMatching(oldRevision),
    });

    collect.mockClear();
    const restarted = createProviderService({
      packages: registryWith({ newapi: { ...providerRegistry.newapi, collect } }),
      clock: () => NOW,
    });
    await restarted.refreshInstance(FIRST, "manual_provider");
    expect(collect).not.toHaveBeenCalled();
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

    const connectionRequest = await authorizedApiRequest(service, {
      providerKind: "newapi",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      apiKey: "candidate-secret",
    });
    const connection = service.connectApiKeyProvider(connectionRequest);
    await createEntered;
    vi.mocked(browser.permissions.contains).mockResolvedValue(false as never);
    const deletion = service.deleteAllLocalData();
    await Promise.resolve();
    releaseCreate?.();

    await connection;
    await expect(deletion).resolves.toEqual({
      result: "deleted",
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
      service.connectApiKeyProvider(await authorizedApiRequest(service, {
        providerKind: "newapi",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
        apiKey: "invalid-secret",
      })),
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
      service.connectApiKeyProvider(await authorizedApiRequest(service, {
        providerKind: "newapi",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
        apiKey: "invalid-secret",
      })),
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

    await service.connectBrowserProvider(
      "chatgpt",
      await authorizedBrowserIntent(service, "chatgpt"),
    );
    await service.connectBrowserProvider(
      "chatgpt",
      await authorizedBrowserIntent(service, "chatgpt"),
    );

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
