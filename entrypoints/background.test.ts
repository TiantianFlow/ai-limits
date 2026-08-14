import { beforeEach, describe, expect, test, vi } from "vitest";

import type { InstanceAppState } from "../domain/instances";
import type { ProviderService } from "../background/provider-service";
import apiKeyConnectionSource from "../background/api-key-connection.ts?raw";
import coordinatorSource from "../background/coordinator.ts?raw";
import orchestratorSource from "../background/orchestrator.ts?raw";
import permissionsSource from "../background/permissions.ts?raw";
import providerAccessSource from "../background/provider-access.ts?raw";
import providerServiceSource from "../background/provider-service.ts?raw";
import registrySource from "../providers/registry.ts?raw";
import backgroundSource from "./background.ts?raw";
import { initializeBackground } from "./background";

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

function invoke(listener: RuntimeListener, message: unknown): Promise<unknown> {
  return new Promise((resolveResponse) => {
    expect(listener(message, {} as Browser.runtime.MessageSender, resolveResponse)).toBe(true);
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
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
});

describe("service-worker activation barrier", () => {
  test("orders vault, migration, package startup, reconciliation, then listener exposure", async () => {
    const order: string[] = [];
    const vault = deferred<void>();
    const migration = deferred<void>();
    const startup = deferred<void>();
    const reconciliation = deferred<void>();
    const service = fakeService({
      reconcilePermissions: vi.fn(async () => {
        order.push("reconcile");
        return reconciliation.promise;
      }),
    });
    const addRuntime = vi
      .spyOn(browser.runtime.onMessage, "addListener")
      .mockImplementation(() => order.push("runtime-listener"));
    const addPermission = vi
      .spyOn(browser.permissions.onRemoved, "addListener")
      .mockImplementation(() => order.push("permission-listener"));
    const addAlarm = vi
      .spyOn(browser.alarms.onAlarm, "addListener")
      .mockImplementation(() => order.push("alarm-listener"));

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
    expect(addRuntime).not.toHaveBeenCalled();
    expect(addPermission).not.toHaveBeenCalled();
    expect(addAlarm).not.toHaveBeenCalled();

    vault.resolve();
    await vi.waitFor(() => expect(order).toEqual(["vault", "grants", "migration"]));
    expect(addRuntime).not.toHaveBeenCalled();

    migration.resolve();
    await vi.waitFor(() => expect(order).toContain("startup"));
    expect(order).not.toContain("create-service");
    expect(addRuntime).not.toHaveBeenCalled();

    startup.resolve();
    await vi.waitFor(() => expect(order).toContain("reconcile"));
    expect(order.indexOf("create-service")).toBeGreaterThan(order.indexOf("startup"));
    expect(addRuntime).not.toHaveBeenCalled();

    reconciliation.resolve();
    await activation;

    expect(order.indexOf("runtime-listener")).toBeGreaterThan(order.indexOf("reconcile"));
    expect(order.indexOf("permission-listener")).toBeGreaterThan(order.indexOf("reconcile"));
    expect(order.indexOf("alarm-listener")).toBeGreaterThan(order.indexOf("reconcile"));
  });

  test("vault or migration failure exposes no listener or service mutation path", async () => {
    const addRuntime = vi.spyOn(browser.runtime.onMessage, "addListener");
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
    expect(addRuntime).not.toHaveBeenCalled();

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
    expect(addRuntime).not.toHaveBeenCalled();
  });

  test("contains package startup cleanup rejection before exposing the live service", async () => {
    const service = fakeService();
    const addRuntime = vi.spyOn(browser.runtime.onMessage, "addListener");

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
    expect(addRuntime).toHaveBeenCalledTimes(1);
  });

  test("reruns the complete barrier on a simulated service-worker restart", async () => {
    const order: string[] = [];
    const service = fakeService({
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
      "vault", "grants", "migration", "startup", "reconcile",
      "vault", "grants", "migration", "startup", "reconcile",
    ]);
    expect(options.createService).toHaveBeenCalledTimes(2);
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

    await initializeBackground({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });

    const response = await invoke(runtimeListener!, { type: "GET_STATE" });
    expect(response).toEqual({
      preferences: { displayMode: "used", autoRefresh: true },
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
    expect(JSON.stringify(response)).not.toContain("config");
  });

  test("forwards external permission removal without deleting instance data", async () => {
    let removedListener:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation((listener) => {
      removedListener = listener as typeof removedListener;
    });
    const service = fakeService();

    await initializeBackground({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });
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
    await initializeBackground({
      initializeVault: async () => undefined,
      grantedPermissions: async () => ({}),
      migrate: async () => undefined,
      packages: [],
      createService: () => service,
      now: () => 1,
    });
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
      "entrypoints/background.ts": backgroundSource,
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
