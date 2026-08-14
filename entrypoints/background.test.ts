import { beforeEach, describe, expect, test, vi } from "vitest";

import type { InstanceAppState } from "../domain/model";
import {
  createProviderService,
  type ProviderService,
} from "../background/provider-service";
import apiKeyConnectionSource from "../background/api-key-connection.ts?raw";
import coordinatorSource from "../background/coordinator.ts?raw";
import orchestratorSource from "../background/orchestrator.ts?raw";
import permissionsSource from "../background/permissions.ts?raw";
import providerAccessSource from "../background/provider-access.ts?raw";
import providerServiceSource from "../background/provider-service.ts?raw";
import messagesSource from "../background/messages.ts?raw";
import registrySource from "../providers/registry.ts?raw";
import stateCodecSource from "../storage/state-codec.ts?raw";
import backgroundSource from "./background.ts?raw";
import {
  initializeBackground,
  registerBackgroundEventCapture,
} from "./background";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const emptyState: InstanceAppState = {
  version: 5,
  preferences: { displayMode: "used", autoRefresh: true },
  instances: [],
};

function fakeService(overrides: Partial<ProviderService> = {}): ProviderService {
  const service: ProviderService = {
    prepareProviderPermission: vi.fn(async () => ({
      permissionIntentId: "550e8400-e29b-41d4-a716-446655440099",
      instanceId: "newapi:550e8400-e29b-41d4-a716-446655440000",
      config: {
        kind: "dynamic-origin" as const,
        baseUrl: "https://relay.example/gateway",
      },
      permissions: {},
    })),
    resolveProviderPermission: vi.fn(async () => undefined),
    abandonProviderPermission: vi.fn(async () => undefined),
    sweepPermissionIntents: vi.fn(async () => undefined),
    connectBrowserProvider: vi.fn(async () => ({
      trigger: "connect" as const,
      startedAt: 1,
      finishedAt: 2,
      results: [],
    })),
    connectApiKeyProvider: vi.fn(async () => ({
      report: {
        trigger: "connect" as const,
        startedAt: 1,
        finishedAt: 2,
        results: [],
      },
      result: "connected" as const,
    })),
    refreshInstance: vi.fn(async () => ({
      trigger: "manual_provider" as const,
      startedAt: 1,
      finishedAt: 2,
      results: [],
    })),
    refreshAll: vi.fn(async () => ({
      trigger: "manual_all" as const,
      startedAt: 1,
      finishedAt: 2,
      results: [],
    })),
    renameInstance: vi.fn(async () => undefined),
    disconnectInstance: vi.fn(async () => ({
      ok: true as const,
      localDataDeleted: true as const,
    })),
    reconcilePermissions: vi.fn(async () => undefined),
    deleteAllLocalData: vi.fn(async () => ({ result: "deleted" as const })),
    getState: vi.fn(async () => emptyState),
    setDisplayMode: vi.fn(async () => undefined),
    setAutoRefresh: vi.fn(async () => undefined),
  };
  return { ...service, ...overrides };
}

type RuntimeListener = (
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

type PermissionListener = (
  permissions: Browser.permissions.Permissions,
) => void;
type AlarmListener = (alarm: Browser.alarms.Alarm) => void;
type ActionListener = (tab: Browser.tabs.Tab) => void;

function invoke(listener: RuntimeListener, message: unknown): Promise<unknown> {
  return new Promise((resolveResponse) => {
    expect(listener(message, {} as Browser.runtime.MessageSender, resolveResponse)).toBe(true);
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
  vi.spyOn(browser.alarms, "get").mockResolvedValue(undefined);
  vi.spyOn(browser.alarms, "clear").mockResolvedValue(true as never);
  vi.spyOn(browser.alarms, "create").mockResolvedValue(undefined);
  vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
    () => undefined,
  );
  vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
    () => undefined,
  );
  vi.spyOn(browser.alarms.onAlarm, "addListener").mockImplementation(
    () => undefined,
  );
  vi.spyOn(browser.action.onClicked, "addListener").mockImplementation(
    () => undefined,
  );
  vi.spyOn(browser.sidePanel, "open").mockResolvedValue(undefined);
});

describe("service-worker activation barrier", () => {
  test("captures first-wake commands, permission changes, alarms, and toolbar clicks before activation", async () => {
    let runtimeListener: RuntimeListener | undefined;
    let removedListener: PermissionListener | undefined;
    let alarmListener: AlarmListener | undefined;
    let actionListener: ActionListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      (listener) => {
        removedListener = listener as PermissionListener;
      },
    );
    vi.spyOn(browser.alarms.onAlarm, "addListener").mockImplementation(
      (listener) => {
        alarmListener = listener as AlarmListener;
      },
    );
    vi.spyOn(browser.action.onClicked, "addListener").mockImplementation(
      (listener) => {
        actionListener = listener as ActionListener;
      },
    );
    const vault = deferred<void>();
    const service = fakeService();

    const registration = registerBackgroundEventCapture({
      initializeVault: () => vault.promise,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });

    expect(runtimeListener).toBeDefined();
    expect(removedListener).toBeDefined();
    expect(alarmListener).toBeDefined();
    expect(actionListener).toBeDefined();

    const stateResponse = invoke(runtimeListener!, { type: "GET_STATE" });
    removedListener!({ origins: ["https://relay.example/*"] });
    alarmListener!({
      name: "refresh-connected",
      scheduledTime: 1,
      persistAcrossSessions: false,
    });
    actionListener!({ windowId: 7 } as Browser.tabs.Tab);
    await Promise.resolve();

    expect(service.reconcilePermissions).not.toHaveBeenCalled();
    expect(service.refreshAll).not.toHaveBeenCalled();
    expect(browser.sidePanel.open).not.toHaveBeenCalled();

    vault.resolve();
    await registration.activation;
    await expect(stateResponse).resolves.toEqual({
      preferences: { displayMode: "used", autoRefresh: true },
      providers: expect.any(Array),
      instances: [],
    });
    await vi.waitFor(() => {
      expect(service.reconcilePermissions).toHaveBeenNthCalledWith(2, {
        origins: ["https://relay.example/*"],
      });
      expect(service.refreshAll).toHaveBeenCalledWith("scheduled");
      expect(browser.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    });
  });

  test("contains startup failure for every synchronously captured wake event", async () => {
    let runtimeListener: RuntimeListener | undefined;
    let removedListener: PermissionListener | undefined;
    let alarmListener: AlarmListener | undefined;
    let actionListener: ActionListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      (listener) => {
        removedListener = listener as PermissionListener;
      },
    );
    vi.spyOn(browser.alarms.onAlarm, "addListener").mockImplementation(
      (listener) => {
        alarmListener = listener as AlarmListener;
      },
    );
    vi.spyOn(browser.action.onClicked, "addListener").mockImplementation(
      (listener) => {
        actionListener = listener as ActionListener;
      },
    );
    const createService = vi.fn(() => fakeService());
    const registration = registerBackgroundEventCapture({
      initializeVault: async () => {
        throw new Error("startup-private-detail");
      },
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService,
      now: () => 1,
    });

    const response = invoke(runtimeListener!, { type: "GET_STATE" });
    removedListener!({ origins: ["https://relay.example/*"] });
    alarmListener!({
      name: "refresh-connected",
      scheduledTime: 1,
      persistAcrossSessions: false,
    });
    actionListener!({ windowId: 7 } as Browser.tabs.Tab);

    await expect(registration.activation).rejects.toThrow(
      "startup-private-detail",
    );
    await expect(response).resolves.toEqual({
      ok: false,
      error: "command_failed",
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(createService).not.toHaveBeenCalled();
    expect(browser.sidePanel.open).not.toHaveBeenCalled();
  });

  test("orders vault, migration, package startup, then live reconciliation", async () => {
    const order: string[] = [];
    const vault = deferred<void>();
    const migration = deferred<void>();
    const startup = deferred<void>();
    const reconciliation = deferred<void>();
    const service = fakeService({
      sweepPermissionIntents: vi.fn(async () => {
        order.push("sweep-intents");
      }),
      reconcilePermissions: vi.fn(async () => {
        order.push("reconcile");
        return reconciliation.promise;
      }),
    });
    const activation = initializeBackground({
      initializeVault: async () => {
        order.push("vault");
        return vault.promise;
      },
      grantedPermissions: async () => {
        order.push("grants");
        return {};
      },
      migrate: async () => {
        order.push("migration");
        return migration.promise;
      },
      packages: [
        {
          startup: async () => {
            order.push("startup");
            return startup.promise;
          },
        },
      ] as never,
      createService: () => {
        order.push("create-service");
        return service;
      },
      now: () => 1,
    });

    expect(order).toEqual(["vault"]);

    vault.resolve();
    await vi.waitFor(() => expect(order).toEqual(["vault", "grants", "migration"]));

    migration.resolve();
    await vi.waitFor(() => expect(order).toContain("startup"));
    expect(order).not.toContain("create-service");

    startup.resolve();
    await vi.waitFor(() => expect(order).toContain("reconcile"));
    expect(order.indexOf("create-service")).toBeGreaterThan(order.indexOf("startup"));
    expect(order.indexOf("sweep-intents")).toBeGreaterThan(
      order.indexOf("create-service"),
    );
    expect(order.indexOf("reconcile")).toBeGreaterThan(
      order.indexOf("sweep-intents"),
    );

    reconciliation.resolve();
    await activation;
  });

  test("vault or migration failure exposes no service mutation path", async () => {
    const createService = vi.fn(() => fakeService());
    const migrate = vi.fn(async () => undefined);

    await expect(
      initializeBackground({
        initializeVault: async () => {
          throw new Error("vault unavailable");
        },
        grantedPermissions: async () => ({}),
        migrate,
        packages: [],
        createService,
        now: () => 1,
      }),
    ).rejects.toThrow("vault unavailable");
    expect(migrate).not.toHaveBeenCalled();
    expect(createService).not.toHaveBeenCalled();

    await expect(
      initializeBackground({
        initializeVault: async () => undefined,
        grantedPermissions: async () => ({}),
        migrate: async () => {
          throw new Error("migration unavailable");
        },
        packages: [],
        createService,
        now: () => 1,
      }),
    ).rejects.toThrow("migration unavailable");
    expect(createService).not.toHaveBeenCalled();
  });

  test("contains package startup cleanup rejection before creating the live service", async () => {
    const service = fakeService();

    await expect(
      initializeBackground({
        initializeVault: async () => undefined,
        grantedPermissions: async () => ({}),
        migrate: async () => undefined,
        packages: [
          { startup: async () => Promise.reject(new Error("cleanup failed")) },
          { startup: vi.fn(async () => undefined) },
        ] as never,
        createService: () => service,
        now: () => 1,
      }),
    ).resolves.toBeUndefined();

    expect(service.reconcilePermissions).toHaveBeenCalledTimes(1);
  });

  test("reruns the complete barrier on a simulated service-worker restart", async () => {
    const order: string[] = [];
    const service = fakeService({
      sweepPermissionIntents: vi.fn(async () => {
        order.push("sweep-intents");
      }),
      reconcilePermissions: vi.fn(async () => {
        order.push("reconcile");
      }),
    });
    const options = {
      initializeVault: vi.fn(async () => {
        order.push("vault");
      }),
      grantedPermissions: vi.fn(async () => {
        order.push("grants");
        return {};
      }),
      migrate: vi.fn(async () => {
        order.push("migration");
      }),
      packages: [{ startup: vi.fn(async () => {
        order.push("startup");
      }) }] as never,
      createService: vi.fn(() => service),
      now: () => 1,
    };

    await initializeBackground(options);
    await initializeBackground(options);

    expect(order).toEqual([
      "vault", "grants", "migration", "startup", "sweep-intents", "reconcile",
      "vault", "grants", "migration", "startup", "sweep-intents", "reconcile",
    ]);
    expect(options.createService).toHaveBeenCalledTimes(2);
  });

  test("startup sweeps a durable intent after session storage is lost on browser restart", async () => {
    const now = Date.parse("2030-04-15T12:00:00.000Z");
    await browser.storage.local.set({
      aiLimitsPermissionIntents: {
        version: 1,
        intents: [
          {
            id: "550e8400-e29b-41d4-a716-446655440099",
            phase: "pending",
            candidate: {
              id: "newapi:550e8400-e29b-41d4-a716-446655440000",
              providerKind: "newapi",
              config: {
                kind: "dynamic-origin",
                baseUrl: "https://relay.example/gateway",
              },
              createdAt: now - 200,
            },
            expiresAt: now - 100,
          },
        ],
      },
    });
    await browser.storage.session.clear();
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

    await initializeBackground({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({
        origins: ["https://relay.example/*"],
      }),
      migrate: async () => undefined,
      packages: [],
      createService: () => createProviderService({ clock: () => now }),
      now: () => now,
    });

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
    expect(JSON.stringify(await browser.storage.local.get(null))).not.toContain(
      "newapi:550e8400-e29b-41d4-a716-446655440000",
    );
  });
});

describe("instance runtime wiring", () => {
  test("registers strict commands only after activation and returns public view state", async () => {
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation((listener) => {
      runtimeListener = listener as RuntimeListener;
    });
    const relayState: InstanceAppState = {
      ...emptyState,
      instances: [
        {
          id: "newapi:550e8400-e29b-41d4-a716-446655440000",
          providerKind: "newapi",
          userLabel: "Relay",
          config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
          access: "granted",
          createdAt: 1,
          history: [],
        },
      ],
    };
    const service = fakeService({
      getState: vi.fn(async () => relayState),
    });

    const registration = registerBackgroundEventCapture({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });
    await registration.activation;

    const response = await invoke(runtimeListener!, { type: "GET_STATE" });
    expect(response).toEqual({
      preferences: { displayMode: "used", autoRefresh: true },
      providers: expect.any(Array),
      instances: [
        {
          id: "newapi:550e8400-e29b-41d4-a716-446655440000",
          providerKind: "newapi",
          userLabel: "Relay",
          baseUrl: "https://relay.example",
          origin: "https://relay.example",
          access: "granted",
          createdAt: 1,
          history: [],
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('"config":');

    const prepared = await invoke(runtimeListener!, {
      type: "PREPARE_PROVIDER_PERMISSION",
      providerKind: "newapi",
      instanceId: "newapi:550e8400-e29b-41d4-a716-446655440000",
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://relay.example/gateway",
      },
    });
    expect(prepared).toEqual({
      state: response,
      permissionIntentId: "550e8400-e29b-41d4-a716-446655440099",
      instanceId: "newapi:550e8400-e29b-41d4-a716-446655440000",
      config: {
        kind: "dynamic-origin",
        baseUrl: "https://relay.example/gateway",
      },
      permissions: {},
    });
    expect(JSON.stringify(prepared)).not.toContain("secret");
  });

  test("forwards external permission removal without deleting instance data", async () => {
    let removedListener:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation((listener) => {
      removedListener = listener as typeof removedListener;
    });
    const service = fakeService();

    const registration = registerBackgroundEventCapture({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });
    await registration.activation;
    removedListener?.({ origins: ["https://relay.example/*"] });

    await vi.waitFor(() =>
      expect(service.reconcilePermissions).toHaveBeenLastCalledWith({
        origins: ["https://relay.example/*"],
      }),
    );
    expect(service.disconnectInstance).not.toHaveBeenCalled();
  });

  test("rolls back auto-refresh state when alarm synchronization fails", async () => {
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    let state: InstanceAppState = structuredClone(emptyState);
    const writes: boolean[] = [];
    const service = fakeService({
      getState: vi.fn(async () => structuredClone(state)),
      setAutoRefresh: vi.fn(async (enabled) => {
        writes.push(enabled);
        state = {
          ...state,
          preferences: { ...state.preferences, autoRefresh: enabled },
        };
      }),
    });
    const registration = registerBackgroundEventCapture({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });
    await registration.activation;
    vi.mocked(browser.alarms.clear).mockRejectedValue(
      new Error("alarm unavailable") as never,
    );
    const response = await invoke(runtimeListener!, {
      type: "SET_AUTO_REFRESH",
      enabled: false,
    });

    expect(response).toEqual({ ok: false, error: "command_failed" });
    expect(writes).toEqual([false, true]);
    expect(state.preferences.autoRefresh).toBe(true);
  });
});

describe("central provider abstraction source contract", () => {
  test("has no provider-kind branches or Task 4 adapter bridge in central runtime files", () => {
    const files = {
      "background/api-key-connection.ts": apiKeyConnectionSource,
      "background/coordinator.ts": coordinatorSource,
      "background/orchestrator.ts": orchestratorSource,
      "background/permissions.ts": permissionsSource,
      "background/provider-access.ts": providerAccessSource,
      "background/provider-service.ts": providerServiceSource,
      "background/messages.ts": messagesSource,
      "entrypoints/background.ts": backgroundSource,
      "storage/state-codec.ts": stateCodecSource,
    };
    const providerKinds = "chatgpt|claude|kimi|cursor|elevenlabs|newapi";
    const comparison = new RegExp(
      `(?:===|!==)\\s*[\"'](?:${providerKinds})[\"']|[\"'](?:${providerKinds})[\"']\\s*(?:===|!==)`,
    );

    for (const [file, source] of Object.entries(files)) {
      expect(source, file).not.toMatch(comparison);
      expect(source, file).not.toContain("legacyProviderAdapterRegistry");
      expect(source, file).not.toContain("providerCatalog[");
    }

    expect(registrySource).not.toContain("legacyProviderAdapterRegistry");
  });
});
