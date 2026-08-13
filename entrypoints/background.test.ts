import { beforeEach, describe, expect, test, vi } from "vitest";

import { deriveRefreshPolicy } from "../background/orchestrator";
import type { AppState } from "../domain/model";
import { createFixtureState } from "../providers/fixtures";
import { loadState, saveState } from "../storage/repository";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const STORED_KEY = "synthetic-stored-key";

function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    tier: "starter",
    character_count: 2_500,
    character_limit: 10_000,
    next_character_count_reset_unix: Date.parse("2030-05-01T00:00:00.000Z") / 1_000,
    character_refresh_period: "monthly_period",
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

type BackgroundModule = typeof import("./background");
type CredentialsModule = typeof import("../storage/credentials");

let background: BackgroundModule;
let credentials: CredentialsModule;
let backgroundMain: (() => void) | undefined;
let setAccessLevel: ReturnType<typeof vi.fn>;

type RuntimeListener = (
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

function invokeRuntimeCommand(
  listener: RuntimeListener,
  command: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    expect(listener(command, {} as Browser.runtime.MessageSender, resolve))
      .toBe(true);
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await browser.storage.local.clear();
  setAccessLevel = vi.fn(async () => undefined);
  Object.assign(browser.storage.local, { setAccessLevel });
  credentials = await import("../storage/credentials");
  background = await import("./background");
  backgroundMain = background.default.main;
});

describe("credential-aware background lifecycle", () => {
  test("replacing a New API instance revokes the prior exact host after validation", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey(
      "newapi",
      "sk-old-key",
      "active",
      "https://old.example.com/v1",
    );
    await saveState(createFixtureState(NOW), NOW);
    const grantedOrigins = new Set(["https://old.example.com/*"]);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        Boolean(request.origins?.every((origin) => grantedOrigins.has(origin))) as never,
    );
    const remove = vi.spyOn(browser.permissions, "remove").mockImplementation(
      async (request) => {
        request.origins?.forEach((origin) => grantedOrigins.delete(origin));
        return true as never;
      },
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    let permissionRemoved:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      (listener) => {
        permissionRemoved = listener as typeof permissionRemoved;
      },
    );
    remove.mockImplementation(async (request) => {
      request.origins?.forEach((origin) => grantedOrigins.delete(origin));
      permissionRemoved?.(request);
      return true as never;
    });
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response({ success: true, data: { system_name: "New instance" } }),
      )
      .mockResolvedValueOnce(
        response({
          code: true,
          data: {
            name: "AI Limits",
            total_granted: 100,
            total_used: 25,
            total_available: 75,
            unlimited_quota: false,
            expires_at: 0,
          },
        }),
      );

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    grantedOrigins.add("https://new.example.com/*");
    permissionAdded?.({ origins: ["https://new.example.com/*"] });
    const result = await invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "newapi",
      apiKey: "sk-new-key",
      baseUrl: "https://new.example.com/v1/messages",
      connectionIntent: "replacement",
    });

    expect(result).toMatchObject({ result: "connected" });
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://old.example.com/*"],
    });
    await expect(credentials.readProviderCredential("newapi")).resolves.toMatchObject({
      value: "sk-new-key",
      baseUrl: "https://new.example.com",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(credentials.readProviderCredential("newapi")).resolves.toMatchObject({
      value: "sk-new-key",
      baseUrl: "https://new.example.com",
    });
  });

  test("failed New API replacement revokes only the candidate host and preserves the active connection", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey(
      "newapi",
      "sk-old-key",
      "active",
      "https://old.example.com",
    );
    await saveState(createFixtureState(NOW), NOW);
    const previousProvider = (await loadState(NOW))?.providers.find(
      (provider) => provider.providerId === "newapi",
    );
    const grantedOrigins = new Set(["https://old.example.com/*"]);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        Boolean(request.origins?.every((origin) => grantedOrigins.has(origin))) as never,
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    let permissionRemoved:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      (listener) => {
        permissionRemoved = listener as typeof permissionRemoved;
      },
    );
    const remove = vi.spyOn(browser.permissions, "remove").mockImplementation(
      async (request) => {
        request.origins?.forEach((origin) => grantedOrigins.delete(origin));
        permissionRemoved?.(request);
        return true as never;
      },
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response({ success: true, data: { system_name: "Candidate" } }),
      )
      .mockResolvedValueOnce(response({}, 401));

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    grantedOrigins.add("https://candidate.example.com/*");
    permissionAdded?.({ origins: ["https://candidate.example.com/*"] });

    await expect(
      invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "newapi",
        apiKey: "sk-invalid-candidate",
        baseUrl: "https://candidate.example.com/v1/messages",
        connectionIntent: "replacement",
      }),
    ).resolves.toMatchObject({ result: "invalid_key" });

    expect(remove).toHaveBeenCalledWith({
      origins: ["https://candidate.example.com/*"],
    });
    expect(grantedOrigins).toEqual(new Set(["https://old.example.com/*"]));
    await expect(credentials.readProviderCredential("newapi")).resolves.toMatchObject({
      value: "sk-old-key",
      baseUrl: "https://old.example.com",
    });
    expect((await loadState(NOW))?.providers.find(
      (provider) => provider.providerId === "newapi",
    )).toEqual(previousProvider);
  });

  test("initializes trusted credential storage when the background starts", async () => {
    expect(backgroundMain).toBeTypeOf("function");
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );

    backgroundMain?.();

    await vi.waitFor(() =>
      expect(setAccessLevel).toHaveBeenCalledWith({
        accessLevel: "TRUSTED_CONTEXTS",
      }),
    );
  });

  test("waits for trusted credential storage before permission reconciliation", async () => {
    const ready = deferred<void>();
    setAccessLevel.mockReturnValue(ready.promise);
    const contains = vi
      .spyOn(browser.permissions, "contains")
      .mockResolvedValue(false as never);
    let onAdded: (() => void) | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        onAdded = listener as () => void;
      },
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    backgroundMain?.();
    expect(onAdded).toBeTypeOf("function");

    onAdded?.();
    await Promise.resolve();
    expect(contains).not.toHaveBeenCalled();

    ready.resolve();
    await vi.waitFor(() => expect(contains).toHaveBeenCalled());
  });

  test("keeps browser-session state available when trusted credential storage initialization fails", async () => {
    setAccessLevel.mockRejectedValueOnce(new Error("trusted storage unavailable"));
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) => request.origins?.includes("https://chatgpt.com/*") as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));

    const state = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    expect(state).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ providerId: "chatgpt", access: "granted" }),
        expect.objectContaining({
          providerId: "elevenlabs",
          access: "required",
        }),
      ]),
    });
    await expect(
      invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "candidate-key",
        connectionIntent: "permission-grant",
      }),
    ).resolves.toEqual({ ok: false, error: "command_failed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("preserves API data but does not assert connection when trusted storage fails with permission present", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    const storedState = createFixtureState(NOW);
    storedState.providers[4]!.snapshot = {
      ...storedState.providers[4]!.snapshot!,
      source: "api-key",
    };
    storedState.providers[4]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(storedState, NOW);
    const persistedBefore = (await loadState(NOW))?.providers[4];
    setAccessLevel.mockRejectedValueOnce(new Error("trusted storage unavailable"));
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const clearAlarm = vi.spyOn(browser.alarms, "clear");

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    const state = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });

    expect(
      (state as AppState).providers.find(
        (provider) => provider.providerId === "elevenlabs",
      ),
    ).toEqual({ ...persistedBefore, access: "required" });
    expect(
      (
        (await browser.storage.local.get("aiLimitsCredentials"))
          .aiLimitsCredentials as {
          providers?: { elevenlabs?: unknown };
        }
      ).providers?.elevenlabs,
    ).toBeDefined();
    expect(clearAlarm).toHaveBeenCalledWith("refresh-connected");
  });

  test.each([
    ["active", "absent permission", "startup"],
    ["rejected", "absent permission", "GET_STATE"],
    ["active", "durable suppression", "startup"],
    ["rejected", "durable suppression", "GET_STATE"],
  ] as const)(
    "%s raw credential is deleted after trusted-storage failure with %s on %s",
    async (status, authority, trigger) => {
      await credentials.initializeCredentialStorage();
      await credentials.saveProviderApiKey("elevenlabs", STORED_KEY, status);
      const storedState = createFixtureState(NOW);
      storedState.providers[4]!.snapshot = {
        ...storedState.providers[4]!.snapshot!,
        source: "api-key",
      };
      storedState.providers[4]!.lastAttempt = {
        trigger: "scheduled",
        startedAt: NOW - 1_000,
        finishedAt: NOW,
        outcome: { kind: "success" },
      };
      await saveState(storedState, NOW);
      if (authority === "durable suppression") {
        const { setProviderConnectionSuppressed } = await import(
          "../storage/connection-suppressions"
        );
        await setProviderConnectionSuppressed("elevenlabs", true);
      }
      setAccessLevel.mockRejectedValueOnce(
        new Error("trusted storage unavailable"),
      );
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      vi.spyOn(browser.permissions, "contains").mockImplementation(
        async (request) =>
          (request.origins?.includes("https://api.elevenlabs.io/*")
            ? authority === "durable suppression"
            : false) as never,
      );
      vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
        () => undefined,
      );
      vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
        () => undefined,
      );
      let startupListener: (() => void) | undefined;
      vi.spyOn(browser.runtime.onStartup, "addListener").mockImplementation(
        (listener) => {
          startupListener = listener as () => void;
        },
      );
      let runtimeListener: RuntimeListener | undefined;
      vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
        (listener) => {
          runtimeListener = listener as RuntimeListener;
        },
      );
      const clearAlarm = vi.spyOn(browser.alarms, "clear");

      backgroundMain?.();
      await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
      if (trigger === "startup") {
        startupListener?.();
      }
      const state = await invokeRuntimeCommand(runtimeListener!, {
        type: "GET_STATE",
      });

      await vi.waitFor(async () => {
        const raw = (await browser.storage.local.get("aiLimitsCredentials"))
          .aiLimitsCredentials as
          | { providers?: { elevenlabs?: unknown } }
          | undefined;
        expect(raw?.providers?.elevenlabs).toBeUndefined();
      });
      expect((state as AppState).providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
      expect(clearAlarm).toHaveBeenCalledWith("refresh-connected");
    },
  );

  test("trusted-storage failure cleanup is idempotent without a stored key", async () => {
    setAccessLevel.mockRejectedValueOnce(new Error("trusted storage unavailable"));
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    const first = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    const second = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });

    expect((first as AppState).providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
    expect((second as AppState).providers[4]).toEqual(
      (first as AppState).providers[4],
    );
  });

  test.each(["suppression", "permission"] as const)(
    "trusted-storage failure deletes raw credential when %s authority read rejects",
    async (failedAuthority) => {
      await credentials.initializeCredentialStorage();
      await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
      const storedState = createFixtureState(NOW);
      storedState.providers[4]!.snapshot = {
        ...storedState.providers[4]!.snapshot!,
        source: "api-key",
      };
      storedState.providers[4]!.lastAttempt = {
        trigger: "scheduled",
        startedAt: NOW - 1_000,
        finishedAt: NOW,
        outcome: { kind: "success" },
      };
      await saveState(storedState, NOW);
      if (failedAuthority === "permission") {
        const { setProviderConnectionSuppressed } = await import(
          "../storage/connection-suppressions"
        );
        await setProviderConnectionSuppressed("elevenlabs", true);
      }
      setAccessLevel.mockRejectedValueOnce(
        new Error("trusted storage unavailable"),
      );
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      vi.spyOn(browser.permissions, "contains").mockImplementation(
        async (request) => {
          if (
            failedAuthority === "permission" &&
            request.origins?.includes("https://api.elevenlabs.io/*")
          ) {
            throw new Error("permission authority unavailable");
          }
          return request.origins?.includes(
            "https://api.elevenlabs.io/*",
          ) as never;
        },
      );
      if (failedAuthority === "suppression") {
        const storageGet = browser.storage.local.get.bind(browser.storage.local);
        let rejectSuppressionRead = true;
        vi.spyOn(browser.storage.local, "get").mockImplementation(
          async (keys) => {
            if (
              rejectSuppressionRead &&
              keys === "aiLimitsConnectionSuppressions"
            ) {
              rejectSuppressionRead = false;
              throw new Error("suppression authority unavailable");
            }
            return storageGet(keys as never);
          },
        );
      }
      vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
        () => undefined,
      );
      vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
        () => undefined,
      );
      const clearAlarm = vi.spyOn(browser.alarms, "clear");

      backgroundMain?.();

      await vi.waitFor(async () => {
        const raw = (await browser.storage.local.get("aiLimitsCredentials"))
          .aiLimitsCredentials as
          | { providers?: { elevenlabs?: unknown } }
          | undefined;
        expect(raw?.providers?.elevenlabs).toBeUndefined();
        expect((await loadState(NOW))?.providers[4]).toEqual({
          providerId: "elevenlabs",
          access: "required",
          history: [],
        });
      });
      expect(clearAlarm).toHaveBeenCalledWith("refresh-connected");
    },
  );

  test.each([
    ["active", "startup"],
    ["rejected", "GET_STATE"],
  ] as const)(
    "%s API key with absent permission is fully deleted during %s reconciliation",
    async (status, trigger) => {
      await credentials.initializeCredentialStorage();
      await credentials.saveProviderApiKey("elevenlabs", STORED_KEY, status);
      const state = createFixtureState(NOW);
      state.providers[4]!.lastAttempt = {
        trigger: "manual_provider",
        startedAt: NOW - 1_000,
        finishedAt: NOW,
        outcome: { kind: "success" },
      };
      await saveState(state, NOW);
      let elevenLabsPermission = true;
      vi.spyOn(browser.permissions, "contains").mockImplementation(
        async (request) =>
          (request.origins?.includes("https://api.elevenlabs.io/*")
            ? elevenLabsPermission
            : false) as never,
      );
      vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
        () => undefined,
      );
      vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
        () => undefined,
      );
      let startupListener: (() => void) | undefined;
      vi.spyOn(browser.runtime.onStartup, "addListener").mockImplementation(
        (listener) => {
          startupListener = listener as () => void;
        },
      );
      let runtimeListener: RuntimeListener | undefined;
      vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
        (listener) => {
          runtimeListener = listener as RuntimeListener;
        },
      );

      backgroundMain?.();
      await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
      await vi.waitFor(async () =>
        expect(
          (await loadState(NOW))?.providers[4]?.access,
        ).toBe("granted"),
      );
      elevenLabsPermission = false;

      if (trigger === "startup") {
        startupListener?.();
        await vi.waitFor(async () =>
          expect(
            await credentials.readProviderCredential("elevenlabs"),
          ).toBeUndefined(),
        );
      }
      const reconciled = await invokeRuntimeCommand(runtimeListener!, {
        type: "GET_STATE",
      });

      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      expect(reconciled).toMatchObject({
        providers: expect.arrayContaining([
          {
            providerId: "elevenlabs",
            access: "required",
            history: [],
          },
        ]),
      });
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    },
  );

  test("restart finalizes interrupted API-key disconnect from durable suppression", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    const state = createFixtureState(NOW);
    state.providers[4]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(state, NOW);
    const { setProviderConnectionSuppressed } = await import(
      "../storage/connection-suppressions"
    );
    await setProviderConnectionSuppressed("elevenlabs", true);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    const removePermission = vi.spyOn(browser.permissions, "remove");

    backgroundMain?.();

    await vi.waitFor(async () => {
      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    });
    expect(removePermission).not.toHaveBeenCalled();
  });

  test("rapid permission regrant cannot admit connect or refresh during stale-key cleanup", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    let elevenLabsPermission = false;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const credentialDeleteStarted = deferred<void>();
    const releaseCredentialDelete = deferred<void>();
    let credentialDeleteObserved = false;
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        const credentialState = (value as Record<string, unknown>)
          .aiLimitsCredentials as
          | { providers?: { elevenlabs?: unknown } }
          | undefined;
        if (
          credentialState &&
          credentialState.providers?.elevenlabs === undefined
        ) {
          credentialDeleteObserved = true;
          credentialDeleteStarted.resolve();
          await releaseCredentialDelete.promise;
        }
        return storageSet(value);
      },
    );
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await vi.waitFor(() => expect(credentialDeleteObserved).toBe(true));
    await credentialDeleteStarted.promise;
    elevenLabsPermission = true;

    const reconnecting = invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "new-candidate-key",
      connectionIntent: "permission-grant",
    });
    const refreshing = invokeRuntimeCommand(runtimeListener!, {
      type: "REFRESH_PROVIDER",
      providerId: "elevenlabs",
    });
    await expect(reconnecting).resolves.toEqual({
      ok: false,
      error: "command_failed",
    });
    await expect(refreshing).resolves.toMatchObject({
      report: {
        providers: {
          elevenlabs: { kind: "skipped" },
        },
      },
    });
    expect(fetch).not.toHaveBeenCalled();

    releaseCredentialDelete.resolve();
    await vi.waitFor(async () =>
      expect(
        await credentials.readProviderCredential("elevenlabs"),
      ).toBeUndefined(),
    );
    expect((await loadState(NOW))?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("failed reconnect after durable suppression cannot revive the disconnected key", async () => {
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({}, 401));

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    const state = createFixtureState(NOW);
    state.providers[4]!.lastAttempt = {
      trigger: "manual_provider",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(state, NOW);
    const { setProviderConnectionSuppressed } = await import(
      "../storage/connection-suppressions"
    );
    await setProviderConnectionSuppressed("elevenlabs", true);

    const result = await invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "invalid-new-key",
      connectionIntent: "permission-grant",
    });

    expect(result).toMatchObject({ result: "invalid_key" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await credentials.readProviderCredential("elevenlabs"))
      .toBeUndefined();
    expect((await loadState(NOW))?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("suppression persistence failure cannot prevent local API-key disconnect cleanup", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (Object.hasOwn(value, "aiLimitsConnectionSuppressions")) {
          throw new Error("suppression persistence failed");
        }
        return storageSet(value);
      },
    );

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    const result = await invokeRuntimeCommand(runtimeListener!, {
      type: "DISCONNECT_PROVIDER",
      providerId: "elevenlabs",
    });

    expect(result).toMatchObject({
      result: {
        ok: false,
        error: "permission_removal_failed",
        localDataDeleted: true,
      },
    });
    expect(await credentials.readProviderCredential("elevenlabs"))
      .toBeUndefined();
    expect((await loadState(NOW))?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("API permission regrant event deletes an orphan before reconciliation", async () => {
    let elevenLabsPermission = false;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(() => expect(permissionAdded).toBeTypeOf("function"));
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    const state = createFixtureState(NOW);
    state.providers[4]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "success" },
    };
    await saveState(state, NOW);

    elevenLabsPermission = true;
    permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });

    await vi.waitFor(async () => {
      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("API permission regrant owns cleanup before deferred reads admit connect or refresh", async () => {
    let elevenLabsPermission = false;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(subscriptionFixture({ tier: "fresh" })));

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    const credentialReadStarted = deferred<void>();
    const releaseCredentialRead = deferred<void>();
    const storageGet = browser.storage.local.get.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "get").mockImplementation(
      async (keys) => {
        if (keys === "aiLimitsCredentials") {
          credentialReadStarted.resolve();
          await releaseCredentialRead.promise;
        }
        return storageGet(keys as never);
      },
    );

    elevenLabsPermission = true;
    permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
    let reconnectFinished = false;
    const reconnecting = invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "new-candidate-key",
      connectionIntent: "permission-grant",
    }).then((result) => {
      reconnectFinished = true;
      return result;
    });
    let refreshFinished = false;
    const refreshing = invokeRuntimeCommand(runtimeListener!, {
      type: "REFRESH_PROVIDER",
      providerId: "elevenlabs",
    }).then((result) => {
      refreshFinished = true;
      return result;
    });
    await credentialReadStarted.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(reconnectFinished).toBe(false);
    expect(refreshFinished).toBe(false);
    const staleRequestWasAdmitted = fetch.mock.calls.length > 0;
    releaseCredentialRead.resolve();

    await expect(reconnecting).resolves.toMatchObject({ result: "connected" });
    await expect(refreshing).resolves.toMatchObject({
      report: {
        providers: {
          elevenlabs: { kind: "skipped" },
        },
      },
    });
    expect(staleRequestWasAdmitted).toBe(false);
    await vi.waitFor(async () =>
      expect(
        await credentials.readProviderCredential("elevenlabs"),
      ).toEqual({
        kind: "api-key",
        value: "new-candidate-key",
        status: "active",
      }),
    );
  });

  test("fresh API connect admitted before permission event survives late onAdded", async () => {
    let elevenLabsPermission = false;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const candidateResponse = deferred<Response>();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => candidateResponse.promise);

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    elevenLabsPermission = true;
    const connecting = invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "fresh-candidate-key",
      connectionIntent: "permission-grant",
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
    candidateResponse.resolve(
      response(subscriptionFixture({ tier: "fresh-connected" })),
    );

    await expect(connecting).resolves.toMatchObject({ result: "connected" });
    await expect(
      credentials.readProviderCredential("elevenlabs"),
    ).resolves.toEqual({
      kind: "api-key",
      value: "fresh-candidate-key",
      status: "active",
    });
    expect((await loadState(NOW))?.providers[4]?.snapshot?.planLabel)
      .toBe("fresh-connected");
  });

  test("stale permission-grant intent cannot delete an established key", async () => {
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    const established = createFixtureState(NOW);
    await saveState(established, NOW);
    const persistedEstablished = (await loadState(NOW))?.providers[4];

    await expect(
      invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "stale-candidate-key",
        connectionIntent: "permission-grant",
      }),
    ).resolves.toEqual({ ok: false, error: "command_failed" });

    expect(fetch).not.toHaveBeenCalled();
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: STORED_KEY,
      status: "active",
    });
    expect((await loadState(NOW))?.providers[4]).toEqual(persistedEstablished);

    permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
    await vi.waitFor(async () =>
      expect(
        await credentials.readProviderCredential("elevenlabs"),
      ).toBeUndefined(),
    );
  });

  test("stale replacement intent purges a regranted orphan before failing", async () => {
    let elevenLabsPermission = false;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    elevenLabsPermission = true;

    await expect(
      invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "stale-replacement-key",
        connectionIntent: "replacement",
      }),
    ).resolves.toEqual({ ok: false, error: "command_failed" });

    expect(fetch).not.toHaveBeenCalled();
    expect(await credentials.readProviderCredential("elevenlabs"))
      .toBeUndefined();
    expect((await loadState(NOW))?.providers[4]).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("older permission sample cannot overwrite newer connection authority", async () => {
    let elevenLabsPermission = false;
    const contains = vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response(subscriptionFixture({ tier: "fresh-authority" })),
      )
      .mockResolvedValueOnce(response({}, 401));

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });

    const staleReconciliationStarted = deferred<void>();
    const releaseStaleReconciliation = deferred<void>();
    let apiPermissionReads = 0;
    contains.mockImplementation(async (request) => {
      if (!request.origins?.includes("https://api.elevenlabs.io/*")) {
        return false as never;
      }
      apiPermissionReads += 1;
      if (apiPermissionReads === 1) {
        return false as never;
      }
      if (apiPermissionReads === 2) {
        staleReconciliationStarted.resolve();
        await releaseStaleReconciliation.promise;
        return false as never;
      }
      return elevenLabsPermission as never;
    });

    const staleStateRead = invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    await staleReconciliationStarted.promise;
    elevenLabsPermission = true;

    await expect(
      invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "fresh-key",
        connectionIntent: "permission-grant",
      }),
    ).resolves.toMatchObject({ result: "connected" });

    releaseStaleReconciliation.resolve();
    await staleStateRead;
    const connectedState = (await loadState(NOW))?.providers[4];

    await expect(
      invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "invalid-replacement",
        connectionIntent: "replacement",
      }),
    ).resolves.toMatchObject({ result: "invalid_key" });
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "fresh-key",
      status: "active",
    });
    expect((await loadState(NOW))?.providers[4]).toEqual(connectedState);
  });

  test.each(
    (["concurrent", "late"] as const).flatMap((timing) =>
      (["suppression", "credential", "state", "permission"] as const).map(
        (dependency) => [timing, dependency] as const,
      ),
    ),
  )(
    "%s onAdded resumes orphan audit after pre-purge %s read failure",
    async (timing, dependency) => {
      const contains = vi.spyOn(browser.permissions, "contains")
        .mockImplementation(
          async (request) =>
            request.origins?.includes("https://api.elevenlabs.io/*") as never,
        );
      let permissionAdded:
        | ((permissions: Browser.permissions.Permissions) => void)
        | undefined;
      vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
        (listener) => {
          permissionAdded = listener as typeof permissionAdded;
        },
      );
      vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
        () => undefined,
      );
      let runtimeListener: RuntimeListener | undefined;
      vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
        (listener) => {
          runtimeListener = listener as RuntimeListener;
        },
      );
      const fetch = vi.spyOn(globalThis, "fetch");

      backgroundMain?.();
      await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
      await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
      await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
      await saveState(createFixtureState(NOW), NOW);

      const dependencyReadStarted = deferred<void>();
      const releaseDependencyRead = deferred<void>();
      let failureArmed = true;
      if (dependency === "permission") {
        contains.mockImplementation(async (request) => {
          if (
            failureArmed &&
            request.origins?.includes("https://api.elevenlabs.io/*")
          ) {
            failureArmed = false;
            dependencyReadStarted.resolve();
            await releaseDependencyRead.promise;
            throw new Error("permission read failed");
          }
          return request.origins?.includes(
            "https://api.elevenlabs.io/*",
          ) as never;
        });
      } else {
        const targetKey = {
          suppression: "aiLimitsConnectionSuppressions",
          credential: "aiLimitsCredentials",
          state: "aiLimitsState",
        }[dependency];
        const storageGet = browser.storage.local.get.bind(browser.storage.local);
        vi.spyOn(browser.storage.local, "get").mockImplementation(
          async (keys) => {
            if (failureArmed && keys === targetKey) {
              failureArmed = false;
              dependencyReadStarted.resolve();
              await releaseDependencyRead.promise;
              throw new Error(`${dependency} read failed`);
            }
            return storageGet(keys as never);
          },
        );
      }

      const connecting = invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "candidate-key",
        connectionIntent: "permission-grant",
      });
      await dependencyReadStarted.promise;
      if (timing === "concurrent") {
        permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
      }
      releaseDependencyRead.resolve();
      await expect(connecting).resolves.toEqual({
        ok: false,
        error: "command_failed",
      });

      if (timing === "late") {
        expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
          kind: "api-key",
          value: STORED_KEY,
          status: "active",
        });
        permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
      }

      await vi.waitFor(async () => {
        expect(await credentials.readProviderCredential("elevenlabs"))
          .toBeUndefined();
        expect((await loadState(NOW))?.providers[4]).toEqual({
          providerId: "elevenlabs",
          access: "required",
          history: [],
        });
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(["concurrent", "late"] as const)(
    "%s onAdded resumes orphan audit after credential initialization failure",
    async (timing) => {
      await credentials.initializeCredentialStorage();
      await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
      await saveState(createFixtureState(NOW), NOW);
      const initializationStarted = deferred<void>();
      const releaseInitialization = deferred<void>();
      setAccessLevel.mockImplementationOnce(async () => {
        initializationStarted.resolve();
        await releaseInitialization.promise;
        throw new Error("trusted storage unavailable");
      });
      vi.spyOn(browser.permissions, "contains").mockImplementation(
        async (request) =>
          request.origins?.includes("https://api.elevenlabs.io/*") as never,
      );
      let permissionAdded:
        | ((permissions: Browser.permissions.Permissions) => void)
        | undefined;
      vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
        (listener) => {
          permissionAdded = listener as typeof permissionAdded;
        },
      );
      vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
        () => undefined,
      );
      let runtimeListener: RuntimeListener | undefined;
      vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
        (listener) => {
          runtimeListener = listener as RuntimeListener;
        },
      );
      const fetch = vi.spyOn(globalThis, "fetch");

      backgroundMain?.();
      await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
      await initializationStarted.promise;
      const connecting = invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "candidate-key",
        connectionIntent: "permission-grant",
      });
      if (timing === "concurrent") {
        permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
      }
      releaseInitialization.resolve();
      await expect(connecting).resolves.toEqual({
        ok: false,
        error: "command_failed",
      });
      if (timing === "late") {
        expect(
          (await browser.storage.local.get("aiLimitsCredentials"))
            .aiLimitsCredentials,
        ).toBeDefined();
        permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
      }

      await vi.waitFor(async () =>
        expect(
          (await browser.storage.local.get("aiLimitsCredentials"))
            .aiLimitsCredentials,
        ).toBeUndefined(),
      );
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test("API permission regrant drains a post-save failed commit without restoring the old key", async () => {
    let elevenLabsPermission = false;
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        (request.origins?.includes("https://api.elevenlabs.io/*")
          ? elevenLabsPermission
          : false) as never,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let permissionAdded:
      | ((permissions: Browser.permissions.Permissions) => void)
      | undefined;
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      (listener) => {
        permissionAdded = listener as typeof permissionAdded;
      },
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(subscriptionFixture({ tier: "candidate" })));

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    elevenLabsPermission = true;
    const stateWriteStarted = deferred<void>();
    const releaseStateWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    let failCandidateStateWrite = true;
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        const storedState = (value as Record<string, unknown>)
          .aiLimitsState as
          | {
              providers?: Array<{
                providerId?: string;
                snapshot?: { planLabel?: string };
              }>;
            }
          | undefined;
        const isCandidateStateWrite = storedState?.providers?.some(
          (provider) =>
            provider.providerId === "elevenlabs" &&
            provider.snapshot?.planLabel === "candidate",
        );
        if (
          failCandidateStateWrite &&
          isCandidateStateWrite
        ) {
          failCandidateStateWrite = false;
          stateWriteStarted.resolve();
          await releaseStateWrite.promise;
          throw new Error("candidate state commit failed");
        }
        return storageSet(value);
      },
    );

    const connecting = invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "candidate-key",
      connectionIntent: "permission-grant",
    });
    await stateWriteStarted.promise;
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "candidate-key",
      status: "active",
    });

    permissionAdded?.({ origins: ["https://api.elevenlabs.io/*"] });
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "candidate-key",
      status: "active",
    });
    releaseStateWrite.resolve();

    await expect(connecting).resolves.toEqual({
      ok: false,
      error: "command_failed",
    });
    await vi.waitFor(async () => {
      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("API disconnect deletes local credential before pending suppression persistence", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    await saveState(createFixtureState(NOW), NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    const removePermission = vi
      .spyOn(browser.permissions, "remove")
      .mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    const suppressionWriteStarted = deferred<void>();
    const releaseSuppressionWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (Object.hasOwn(value, "aiLimitsConnectionSuppressions")) {
          suppressionWriteStarted.resolve();
          await releaseSuppressionWrite.promise;
        }
        return storageSet(value);
      },
    );
    const disconnecting = invokeRuntimeCommand(runtimeListener!, {
      type: "DISCONNECT_PROVIDER",
      providerId: "elevenlabs",
    });
    await suppressionWriteStarted.promise;

    await vi.waitFor(async () => {
      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      expect((await loadState(NOW))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    });
    expect(removePermission).not.toHaveBeenCalled();

    releaseSuppressionWrite.resolve();
    await expect(disconnecting).resolves.toMatchObject({
      result: {
        ok: false,
        error: "permission_removal_failed",
        localDataDeleted: true,
      },
    });
  });

  test("browser-session suppression failure reports retained access across reconciliation", async () => {
    await saveState(createFixtureState(NOW), NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://chatgpt.com/*") as never,
    );
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);
    let startupListener: (() => void) | undefined;
    vi.spyOn(browser.runtime.onStartup, "addListener").mockImplementation(
      (listener) => {
        startupListener = listener as () => void;
      },
    );
    let alarmListener: ((alarm: Browser.alarms.Alarm) => void) | undefined;
    vi.spyOn(browser.alarms.onAlarm, "addListener").mockImplementation(
      (listener) => {
        alarmListener = listener as typeof alarmListener;
      },
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (Object.hasOwn(value, "aiLimitsConnectionSuppressions")) {
          throw new Error("suppression persistence failed");
        }
        return storageSet(value);
      },
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({}, 401));

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    const disconnected = await invokeRuntimeCommand(runtimeListener!, {
      type: "DISCONNECT_PROVIDER",
      providerId: "chatgpt",
    });
    expect(disconnected).toMatchObject({
      state: {
        providers: expect.arrayContaining([
          expect.objectContaining({
            providerId: "chatgpt",
            access: "granted",
          }),
        ]),
      },
      result: {
        ok: false,
        error: "permission_removal_failed",
        localDataDeleted: true,
      },
    });

    const reloaded = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    expect(reloaded).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "chatgpt",
          access: "granted",
        }),
      ]),
    });
    startupListener?.();
    await vi.waitFor(async () =>
      expect((await loadState(NOW))?.providers[0]?.access).toBe("granted"),
    );
    alarmListener?.({ name: "refresh-connected" } as Browser.alarms.Alarm);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  test("returns local disconnect success and syncs state when permission cleanup fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const containsPermission = vi
      .spyOn(browser.permissions, "contains")
      .mockImplementation(
        async (request) =>
          request.origins?.includes("https://chatgpt.com/*") as never,
      );
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let startupListener: (() => void) | undefined;
    vi.spyOn(browser.runtime.onStartup, "addListener").mockImplementation(
      (listener) => {
        startupListener = listener as () => void;
      },
    );
    let alarmListener: ((alarm: Browser.alarms.Alarm) => void) | undefined;
    vi.spyOn(browser.alarms.onAlarm, "addListener").mockImplementation(
      (listener) => {
        alarmListener = listener as typeof alarmListener;
      },
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const clearAlarm = vi.spyOn(browser.alarms, "clear");
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(async () =>
      expect(
        (await loadState(NOW))?.providers.find(
          (provider) => provider.providerId === "chatgpt",
        )?.access,
      ).toBe("granted"),
    );
    clearAlarm.mockClear();

    const disconnectResponse = await invokeRuntimeCommand(runtimeListener!, {
      type: "DISCONNECT_PROVIDER",
      providerId: "chatgpt",
    });

    expect(disconnectResponse).toMatchObject({
      state: {
        providers: expect.arrayContaining([
          { providerId: "chatgpt", access: "required", history: [] },
        ]),
      },
      result: {
        ok: false,
        error: "permission_removal_failed",
        localDataDeleted: true,
      },
    });
    expect(clearAlarm).toHaveBeenCalledWith("refresh-connected");
    expect(
      (await loadState(NOW))?.providers.find(
        (provider) => provider.providerId === "chatgpt",
      ),
    ).toEqual({ providerId: "chatgpt", access: "required", history: [] });

    clearAlarm.mockClear();
    const reloaded = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    expect(reloaded).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "chatgpt",
          access: "required",
        }),
      ]),
    });
    expect(clearAlarm).toHaveBeenCalledWith("refresh-connected");

    containsPermission.mockClear();
    startupListener?.();
    await vi.waitFor(() => expect(containsPermission).toHaveBeenCalled());
    expect(
      (await loadState(NOW))?.providers.find(
        (provider) => provider.providerId === "chatgpt",
      )?.access,
    ).toBe("required");

    clearAlarm.mockClear();
    alarmListener?.({ name: "refresh-connected" } as Browser.alarms.Alarm);
    await vi.waitFor(() =>
      expect(clearAlarm).toHaveBeenCalledWith("refresh-connected"),
    );
    expect(fetch).not.toHaveBeenCalled();

    fetch.mockResolvedValue(response({}, 401));
    const reconnect = await invokeRuntimeCommand(runtimeListener!, {
      type: "COLLECT_PROVIDER",
      providerId: "chatgpt",
    });
    expect(reconnect).toMatchObject({
      state: {
        providers: expect.arrayContaining([
          expect.objectContaining({
            providerId: "chatgpt",
            access: "granted",
          }),
        ]),
      },
    });
    expect(fetch).toHaveBeenCalled();
  });

  test("pending suppression prevents GET_STATE from regranting a partial disconnect", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://chatgpt.com/*") as never,
    );
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const suppressionWriteStarted = deferred<void>();
    const releaseSuppressionWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (Object.hasOwn(value, "aiLimitsConnectionSuppressions")) {
          suppressionWriteStarted.resolve();
          await releaseSuppressionWrite.promise;
        }
        return storageSet(value);
      },
    );

    backgroundMain?.();
    await vi.waitFor(async () =>
      expect(
        (await loadState(NOW))?.providers.find(
          (provider) => provider.providerId === "chatgpt",
        )?.access,
      ).toBe("granted"),
    );
    const disconnecting = invokeRuntimeCommand(runtimeListener!, {
      type: "DISCONNECT_PROVIDER",
      providerId: "chatgpt",
    });
    await suppressionWriteStarted.promise;

    const concurrentState = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    releaseSuppressionWrite.resolve();
    const disconnectResponse = await disconnecting;

    expect(concurrentState).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "chatgpt",
          access: "required",
        }),
      ]),
    });
    expect(disconnectResponse).toMatchObject({
      state: {
        providers: expect.arrayContaining([
          expect.objectContaining({
            providerId: "chatgpt",
            access: "required",
          }),
        ]),
      },
      result: { localDataDeleted: true },
    });
  });

  test("Delete all owns pending suppression before GET_STATE and rejects reconnect clearing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://chatgpt.com/*") as never,
    );
    vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
      origins: ["https://chatgpt.com/*"],
      permissions: [],
    } as never);
    vi.spyOn(browser.permissions, "remove").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const suppressionWriteStarted = deferred<void>();
    const releaseSuppressionWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (Object.hasOwn(value, "aiLimitsConnectionSuppressions")) {
          suppressionWriteStarted.resolve();
          await releaseSuppressionWrite.promise;
        }
        return storageSet(value);
      },
    );
    const fetch = vi.spyOn(globalThis, "fetch");

    backgroundMain?.();
    await vi.waitFor(async () =>
      expect(
        (await loadState(NOW))?.providers.find(
          (provider) => provider.providerId === "chatgpt",
        )?.access,
      ).toBe("granted"),
    );
    const deleting = invokeRuntimeCommand(runtimeListener!, {
      type: "DELETE_LOCAL_DATA",
    });
    await suppressionWriteStarted.promise;

    const reconnecting = invokeRuntimeCommand(runtimeListener!, {
      type: "COLLECT_PROVIDER",
      providerId: "chatgpt",
    });
    const concurrentState = await invokeRuntimeCommand(runtimeListener!, {
      type: "GET_STATE",
    });
    expect(concurrentState).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "chatgpt",
          access: "required",
        }),
      ]),
    });
    await expect(reconnecting).resolves.toEqual({
      ok: false,
      error: "command_failed",
    });
    expect(fetch).not.toHaveBeenCalled();

    releaseSuppressionWrite.resolve();
    await expect(deleting).resolves.toMatchObject({
      result: "deleted_with_permission_errors",
      state: {
        providers: expect.arrayContaining([
          expect.objectContaining({
            providerId: "chatgpt",
            access: "required",
          }),
        ]),
      },
    });
  });

  test.each(["disconnect", "external permission removal", "Delete all data"] as const)(
    "%s invalidates a deferred API-key connection before local cleanup",
    async (cleanupKind) => {
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      vi.spyOn(browser.permissions, "contains").mockImplementation(
        async (request) =>
          request.origins?.includes("https://api.elevenlabs.io/*") as never,
      );
      vi.spyOn(browser.permissions, "remove").mockResolvedValue(true as never);
      vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
        origins: [],
        permissions: [],
      } as never);
      vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
        () => undefined,
      );
      let permissionRemoved: ((permissions: Browser.permissions.Permissions) => void)
        | undefined;
      vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
        (listener) => {
          permissionRemoved = listener as typeof permissionRemoved;
        },
      );
      let runtimeListener: RuntimeListener | undefined;
      vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
        (listener) => {
          runtimeListener = listener as RuntimeListener;
        },
      );
      const pendingResponse = deferred<Response>();
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() => pendingResponse.promise);
      const storageSet = vi.spyOn(browser.storage.local, "set");

      backgroundMain?.();
      await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
      const connecting = invokeRuntimeCommand(runtimeListener!, {
        type: "CONNECT_API_KEY_PROVIDER",
        providerId: "elevenlabs",
        apiKey: "deferred-candidate-key",
        connectionIntent: "permission-grant",
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      storageSet.mockClear();

      if (cleanupKind === "disconnect") {
        await invokeRuntimeCommand(runtimeListener!, {
          type: "DISCONNECT_PROVIDER",
          providerId: "elevenlabs",
        });
      } else if (cleanupKind === "Delete all data") {
        await invokeRuntimeCommand(runtimeListener!, {
          type: "DELETE_LOCAL_DATA",
        });
      } else {
        permissionRemoved?.({ origins: ["https://api.elevenlabs.io/*"] });
        await vi.waitFor(() =>
          expect(storageSet.mock.calls.some(([value]) =>
            Object.hasOwn(value, "aiLimitsCredentials"),
          )).toBe(true),
        );
      }

      pendingResponse.resolve(response(subscriptionFixture()));
      await expect(connecting).resolves.toMatchObject({
        result: "temporary_error",
        report: {
          providers: {
            elevenlabs: { kind: "skipped", reason: "superseded" },
          },
        },
      });
      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      await vi.waitFor(async () =>
        expect(
          (await loadState(NOW))?.providers.find(
            (provider) => provider.providerId === "elevenlabs",
          ),
        ).toEqual({
          providerId: "elevenlabs",
          access: "required",
          history: [],
        }),
      );
    },
  );

  test("disconnect blocks a refresh admitted while permission cleanup is pending", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    const permissionRemoval = deferred<boolean>();
    const removePermission = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(() => permissionRemoval.promise as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const pendingResponse = deferred<Response>();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => pendingResponse.promise);

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    const disconnecting = invokeRuntimeCommand(runtimeListener!, {
      type: "DISCONNECT_PROVIDER",
      providerId: "elevenlabs",
    });
    await vi.waitFor(() => expect(removePermission).toHaveBeenCalledOnce());

    let refreshFinished = false;
    const refreshing = invokeRuntimeCommand(runtimeListener!, {
      type: "REFRESH_PROVIDER",
      providerId: "elevenlabs",
    }).then((result) => {
      refreshFinished = true;
      return result;
    });
    await vi.waitFor(() =>
      expect(refreshFinished || fetch.mock.calls.length > 0).toBe(true),
    );
    const requestWasAdmitted = fetch.mock.calls.length > 0;

    permissionRemoval.resolve(true);
    await disconnecting;
    pendingResponse.resolve(response(subscriptionFixture()));
    const refreshResult = await refreshing;

    expect(requestWasAdmitted).toBe(false);
    expect(refreshResult).toMatchObject({
      report: {
        providers: { elevenlabs: { kind: "skipped" } },
      },
    });
    expect(await credentials.readProviderCredential("elevenlabs"))
      .toBeUndefined();
    expect(
      (await loadState(NOW))?.providers.find(
        (provider) => provider.providerId === "elevenlabs",
      ),
    ).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("Delete all data blocks a connect admitted while permission cleanup is pending", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(false as never);
    vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
      origins: ["https://api.elevenlabs.io/*"],
      permissions: [],
    } as never);
    const permissionRemoval = deferred<boolean>();
    const removePermission = vi
      .spyOn(browser.permissions, "remove")
      .mockImplementation(() => permissionRemoval.promise as never);
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const pendingResponse = deferred<Response>();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => pendingResponse.promise);

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    const deleting = invokeRuntimeCommand(runtimeListener!, {
      type: "DELETE_LOCAL_DATA",
    });
    await vi.waitFor(() => expect(removePermission).toHaveBeenCalledOnce());

    let connectFinished = false;
    const connecting = invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "blocked-during-delete",
      connectionIntent: "permission-grant",
    }).then((result) => {
      connectFinished = true;
      return result;
    });
    await vi.waitFor(() =>
      expect(connectFinished || fetch.mock.calls.length > 0).toBe(true),
    );
    const requestWasAdmitted = fetch.mock.calls.length > 0;

    permissionRemoval.resolve(true);
    await deleting;
    pendingResponse.resolve(response(subscriptionFixture()));
    const connectResult = await connecting;

    expect(requestWasAdmitted).toBe(false);
    expect(connectResult).toEqual({ ok: false, error: "command_failed" });
    expect(await credentials.readProviderCredential("elevenlabs"))
      .toBeUndefined();
    expect(
      (await loadState(NOW))?.providers.find(
        (provider) => provider.providerId === "elevenlabs",
      ),
    ).toEqual({
      providerId: "elevenlabs",
      access: "required",
      history: [],
    });
  });

  test("a refresh starting during candidate validation cannot complete afterward", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "old-key");
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(browser.permissions, "contains").mockImplementation(
      async (request) =>
        request.origins?.includes("https://api.elevenlabs.io/*") as never,
    );
    vi.spyOn(browser.permissions.onAdded, "addListener").mockImplementation(
      () => undefined,
    );
    vi.spyOn(browser.permissions.onRemoved, "addListener").mockImplementation(
      () => undefined,
    );
    let runtimeListener: RuntimeListener | undefined;
    vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation(
      (listener) => {
        runtimeListener = listener as RuntimeListener;
      },
    );
    const candidateResponse = deferred<Response>();
    const staleRefreshResponse = deferred<Response>();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => candidateResponse.promise)
      .mockImplementationOnce(() => staleRefreshResponse.promise);

    backgroundMain?.();
    await vi.waitFor(() => expect(runtimeListener).toBeTypeOf("function"));
    await invokeRuntimeCommand(runtimeListener!, { type: "GET_STATE" });
    const connecting = invokeRuntimeCommand(runtimeListener!, {
      type: "CONNECT_API_KEY_PROVIDER",
      providerId: "elevenlabs",
      apiKey: "new-candidate-key",
      connectionIntent: "replacement",
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    let refreshFinished = false;
    const refreshing = invokeRuntimeCommand(runtimeListener!, {
      type: "REFRESH_PROVIDER",
      providerId: "elevenlabs",
    }).then((result) => {
      refreshFinished = true;
      return result;
    });
    await vi.waitFor(() =>
      expect(refreshFinished || fetch.mock.calls.length > 1).toBe(true),
    );
    const staleRefreshWasAdmitted = fetch.mock.calls.length > 1;

    candidateResponse.resolve(
      response(subscriptionFixture({ tier: "new-key-plan" })),
    );
    await expect(connecting).resolves.toMatchObject({ result: "connected" });
    staleRefreshResponse.resolve(
      response(subscriptionFixture({ tier: "stale-old-key-plan" })),
    );
    const refreshResult = await refreshing;

    expect(staleRefreshWasAdmitted).toBe(false);
    expect(refreshResult).toMatchObject({
      report: {
        providers: { elevenlabs: { kind: "skipped" } },
      },
    });
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "new-candidate-key",
      status: "active",
    });
    expect(
      (await loadState(NOW))?.providers.find(
        (provider) => provider.providerId === "elevenlabs",
      )?.snapshot?.planLabel,
    ).toBe("new-key-plan");
  });

  test("injects an active stored key only into its provider request", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(subscriptionFixture()));
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const controller = new AbortController();

    const outcome = await background.collectProvider(
      "elevenlabs",
      deriveRefreshPolicy("manual_provider"),
      () => true,
      Promise.resolve(),
      controller.signal,
    );

    expect(outcome.kind).toBe("success");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        "xi-api-key": STORED_KEY,
      },
    });
  });

  test("does not inject or send a rejected stored key", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY, "rejected");
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const outcome = await background.collectProvider(
      "elevenlabs",
      deriveRefreshPolicy("scheduled"),
      () => true,
      Promise.resolve(),
      new AbortController().signal,
    );

    expect(outcome).toEqual({
      kind: "failure",
      category: "signed_out",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("marks an active stored key rejected after its provider returns 401", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}, 401));
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const outcome = await background.collectProvider(
      "elevenlabs",
      deriveRefreshPolicy("manual_provider"),
      () => true,
      Promise.resolve(),
      new AbortController().signal,
    );

    expect(outcome).toEqual({
      kind: "failure",
      category: "credential_invalid",
    });
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: STORED_KEY,
      status: "rejected",
    });
  });

  test("does not let a stale 401 reject a replacement key", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "request-key-a");
    const pendingResponse = deferred<Response>();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => pendingResponse.promise);
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const refresh = background.collectProvider(
      "elevenlabs",
      deriveRefreshPolicy("manual_provider"),
      () => true,
      Promise.resolve(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await credentials.saveProviderApiKey("elevenlabs", "replacement-key-b");
    pendingResponse.resolve(response({}, 401));

    await expect(refresh).resolves.toEqual({
      kind: "failure",
      category: "credential_invalid",
    });
    expect(await credentials.readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "replacement-key-b",
      status: "active",
    });
  });

  test.each(["returns false", "rejects"] as const)(
    "Delete all data clears provider state and credentials when permission cleanup %s",
    async (failureMode) => {
      await credentials.initializeCredentialStorage();
      await credentials.saveProviderApiKey("elevenlabs", STORED_KEY);
      await saveState(createFixtureState(NOW), NOW);
      vi.spyOn(browser.permissions, "getAll").mockResolvedValue({
        origins: ["https://api.elevenlabs.io/*"],
        permissions: [],
      } as never);
      const remove = vi.spyOn(browser.permissions, "remove");
      if (failureMode === "returns false") {
        remove.mockResolvedValue(false as never);
      } else {
        remove.mockRejectedValue(new Error("Chrome permission failure"));
      }

      const result = await background.deleteLocalDataWithPermissionCleanup();

      expect(result.result).toBe("deleted_with_permission_errors");
      expect(await credentials.readProviderCredential("elevenlabs"))
        .toBeUndefined();
      expect((await loadState(NOW))?.providers).toEqual(
        expect.arrayContaining([
          {
            providerId: "elevenlabs",
            access: "required",
            history: [],
          },
        ]),
      );
    },
  );
});
