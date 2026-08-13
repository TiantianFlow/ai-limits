import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../providers/types";
import { isApiKeyProviderId } from "../providers/catalog";
import {
  initializeCredentialStorage,
  markProviderCredentialRejectedIfRevision,
  readProviderCredential,
  readProviderCredentialWithRevision,
  saveProviderApiKey,
  saveProviderApiKeyIfCurrent,
} from "../storage/credentials";
import {
  connectApiKeyProvider,
  createApiKeyConnectionLifecycle,
  markStoredApiKeyRejectedForOutcome,
} from "./api-key-connection";
import { reconcileRemovedProviderPermissions } from "./coordinator";
import {
  deleteAllLocalData,
  disconnectProviderData,
  ensureState,
  loadState,
} from "../storage/repository";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const CANDIDATE_KEY = "synthetic-candidate-key";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

function context(fetch: typeof globalThis.fetch): Omit<CollectionContext, "credential"> {
  return {
    fetch,
    now: NOW,
    signal: new AbortController().signal,
  };
}

function lifecycleContext(
  fetch: typeof globalThis.fetch,
): Omit<CollectionContext, "credential" | "signal"> {
  return { fetch, now: NOW };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialStorage();
});

describe("API-key connection transaction", () => {
  test("a newer connection supersedes a late response and only the latest key wins", async () => {
    const firstResponse = deferred<Response>();
    const firstFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => firstResponse.promise);
    const secondFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(subscriptionFixture({ tier: "latest-plan" })),
      );
    const lifecycle = createApiKeyConnectionLifecycle();

    const first = lifecycle.connect(
      "elevenlabs",
      "first-key",
      lifecycleContext(firstFetch),
      () => NOW + 1_000,
    );
    await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledOnce());
    const second = lifecycle.connect(
      "elevenlabs",
      "latest-key",
      lifecycleContext(secondFetch),
      () => NOW + 2_000,
    );
    await expect(second).resolves.toMatchObject({ result: "connected" });
    expect(
      (firstFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal
        ?.aborted,
    ).toBe(true);

    firstResponse.resolve(
      response(subscriptionFixture({ tier: "stale-plan" })),
    );
    await expect(first).resolves.toMatchObject({
      result: "temporary_error",
      report: {
        providers: {
          elevenlabs: { kind: "skipped", reason: "superseded" },
        },
      },
    });

    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "latest-key",
      status: "active",
    });
    expect((await loadState(NOW + 2_000))?.providers[4]?.snapshot?.planLabel)
      .toBe("latest-plan");
  });

  test("a superseded candidate cannot write after waiting in the credential queue", async () => {
    await saveProviderApiKey("elevenlabs", "prior-active-key");
    const storedCredentials = await browser.storage.local.get(null);
    const blockedRead = deferred<Record<string, unknown>>();
    const storageGet = vi
      .spyOn(browser.storage.local, "get")
      .mockImplementationOnce(() => blockedRead.promise as never);
    const firstFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(subscriptionFixture({ tier: "superseded" })));
    const secondFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 401));
    const lifecycle = createApiKeyConnectionLifecycle();

    const first = lifecycle.connect(
      "elevenlabs",
      "superseded-key",
      lifecycleContext(firstFetch),
      () => NOW + 1_000,
    );
    await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalledOnce());
    await expect(
      lifecycle.connect(
        "elevenlabs",
        "failed-newer-key",
        lifecycleContext(secondFetch),
        () => NOW + 2_000,
      ),
    ).resolves.toMatchObject({ result: "invalid_key" });

    blockedRead.resolve(storedCredentials);
    await expect(first).resolves.toMatchObject({
      result: "temporary_error",
      report: {
        providers: {
          elevenlabs: { kind: "skipped", reason: "superseded" },
        },
      },
    });
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "prior-active-key",
      status: "active",
    });
  });

  test("a candidate superseded while its credential write is pending rolls back after a newer failure", async () => {
    await saveProviderApiKey("elevenlabs", "prior-active-key");
    const candidateWriteStarted = deferred<void>();
    const releaseCandidateWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        const credentialState = (value as Record<string, unknown>)
          .aiLimitsCredentials as
          | {
              providers?: {
                elevenlabs?: { value?: unknown };
              };
            }
          | undefined;
        if (
          credentialState?.providers?.elevenlabs?.value ===
          "superseded-pending-key"
        ) {
          candidateWriteStarted.resolve();
          await releaseCandidateWrite.promise;
        }
        return storageSet(value);
      },
    );
    const lifecycle = createApiKeyConnectionLifecycle();
    const first = lifecycle.connect(
      "elevenlabs",
      "superseded-pending-key",
      lifecycleContext(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture())),
      ),
      () => NOW + 1_000,
    );
    await candidateWriteStarted.promise;

    await expect(
      lifecycle.connect(
        "elevenlabs",
        "failed-newer-key",
        lifecycleContext(
          vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValue(response({}, 401)),
        ),
        () => NOW + 2_000,
      ),
    ).resolves.toMatchObject({ result: "invalid_key" });
    releaseCandidateWrite.resolve();

    await expect(first).resolves.toMatchObject({
      result: "temporary_error",
      report: {
        providers: {
          elevenlabs: { kind: "skipped", reason: "superseded" },
        },
      },
    });
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "prior-active-key",
      status: "active",
    });
  });

  test.each([
    [
      "disconnect",
      async (lifecycle: ReturnType<typeof createApiKeyConnectionLifecycle>) => {
        lifecycle.invalidateProvider("elevenlabs");
        await disconnectProviderData("elevenlabs");
      },
    ],
    [
      "external permission removal",
      async (lifecycle: ReturnType<typeof createApiKeyConnectionLifecycle>) => {
        vi.spyOn(browser.permissions, "contains").mockResolvedValue(
          false as never,
        );
        await reconcileRemovedProviderPermissions(
          { origins: ["https://api.elevenlabs.io/*"] },
          ["elevenlabs"],
          (providerId) => {
            if (isApiKeyProviderId(providerId)) {
              lifecycle.invalidateProvider(providerId);
            }
          },
        );
      },
    ],
    [
      "Delete all data",
      async (lifecycle: ReturnType<typeof createApiKeyConnectionLifecycle>) => {
        lifecycle.invalidateAll();
        await deleteAllLocalData();
      },
    ],
  ] as const)(
    "%s prevents a deferred successful response from resurrecting credentials or state",
    async (_label, cleanup) => {
      const pendingResponse = deferred<Response>();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(() => pendingResponse.promise);
      const lifecycle = createApiKeyConnectionLifecycle();
      const connecting = lifecycle.connect(
        "elevenlabs",
        CANDIDATE_KEY,
        lifecycleContext(fetch),
        () => NOW + 1_000,
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

      await cleanup(lifecycle);
      expect(
        (fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted,
      ).toBe(true);
      pendingResponse.resolve(response(subscriptionFixture()));

      await expect(connecting).resolves.toMatchObject({
        result: "temporary_error",
        report: {
          providers: {
            elevenlabs: { kind: "skipped", reason: "superseded" },
          },
        },
      });
      expect(await readProviderCredential("elevenlabs")).toBeUndefined();
      expect((await loadState(NOW + 1_000))?.providers[4]).toEqual({
        providerId: "elevenlabs",
        access: "required",
        history: [],
      });
    },
  );

  test.each(["   ", "x".repeat(4_097)])(
    "rejects an invalid candidate before making a request",
    async (apiKey) => {
      const fetch = vi.fn<typeof globalThis.fetch>();

      await expect(
        connectApiKeyProvider(
          "elevenlabs",
          apiKey,
          context(fetch),
          () => true,
          () => NOW + 1_000,
        ),
      ).rejects.toThrow("API key connection failed.");

      expect(fetch).not.toHaveBeenCalled();
      expect(await readProviderCredential("elevenlabs")).toBeUndefined();
    },
  );

  test("validates once, saves the key before committing success, and returns only sanitized fields", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(subscriptionFixture()));
    const storageSet = vi.spyOn(browser.storage.local, "set");

    const result = await connectApiKeyProvider(
      "elevenlabs",
      CANDIDATE_KEY,
      context(fetch),
      () => true,
      () => NOW + 1_000,
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: CANDIDATE_KEY,
      status: "active",
    });
    const credentialWrite = storageSet.mock.calls.findIndex(
      ([value]) => Object.hasOwn(value, "aiLimitsCredentials"),
    );
    const stateWrite = storageSet.mock.calls.findIndex(
      ([value]) => Object.hasOwn(value, "aiLimitsState"),
    );
    expect(credentialWrite).toBeGreaterThanOrEqual(0);
    expect(stateWrite).toBeGreaterThan(credentialWrite);
    expect(Object.keys(result)).toEqual(["state", "report", "result"]);
    expect(result.result).toBe("connected");
    expect(result.report).toMatchObject({
      trigger: "connect",
      providers: { elevenlabs: { kind: "success" } },
    });
    expect(JSON.stringify(result)).not.toContain(CANDIDATE_KEY);
  });

  test.each([
    [401, "invalid_key", "credential_invalid"],
    [403, "insufficient_scope", "credential_scope_required"],
    [429, "temporary_error", "temporary_error"],
    [500, "temporary_error", "temporary_error"],
  ] as const)(
    "does not save HTTP %i and returns %s without its response body",
    async (status, resultKind, category) => {
      const responseSecret = `response-body-secret-${status}`;
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response({ detail: responseSecret }, status));
      const stateBefore = await ensureState(NOW);

      const result = await connectApiKeyProvider(
        "elevenlabs",
        CANDIDATE_KEY,
        context(fetch),
        () => true,
        () => NOW + 1_000,
      );

      expect(fetch).toHaveBeenCalledOnce();
      expect(await readProviderCredential("elevenlabs")).toBeUndefined();
      expect(result.result).toBe(resultKind);
      expect(result.report.providers.elevenlabs).toMatchObject({
        kind: "failure",
        category,
      });
      expect(result.state).toEqual(stateBefore);
      expect(await loadState(NOW + 1_000)).toEqual(stateBefore);
      expect(JSON.stringify(result)).not.toMatch(
        new RegExp(`${CANDIDATE_KEY}|${responseSecret}`),
      );
    },
  );

  test("does not save a key when a successful response drifts from the schema", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(subscriptionFixture({ character_count: "unexpected" })),
      );

    const stateBefore = await ensureState(NOW);
    const result = await connectApiKeyProvider(
      "elevenlabs",
      CANDIDATE_KEY,
      context(fetch),
      () => true,
      () => NOW + 1_000,
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(await readProviderCredential("elevenlabs")).toBeUndefined();
    expect(result.result).toBe("temporary_error");
    expect(result.report.providers.elevenlabs).toEqual({
      kind: "failure",
      category: "provider_changed",
    });
    expect(result.state).toEqual(stateBefore);
    expect(await loadState(NOW + 1_000)).toEqual(stateBefore);
  });

  test("preserves the prior key and durable state exactly when replacement validation fails", async () => {
    await connectApiKeyProvider(
      "elevenlabs",
      "prior-active-key",
      context(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture({ tier: "prior-plan" }))),
      ),
      () => true,
      () => NOW + 500,
    );
    const stateBefore = await loadState(NOW + 500);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 401));

    const result = await connectApiKeyProvider(
      "elevenlabs",
      CANDIDATE_KEY,
      context(fetch),
      () => true,
      () => NOW + 1_000,
    );

    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "prior-active-key",
      status: "active",
    });
    expect(result.state).toEqual(stateBefore);
    expect(await loadState(NOW + 1_000)).toEqual(stateBefore);
  });

  test("overwrites a prior key only after its replacement validates", async () => {
    await saveProviderApiKey("elevenlabs", "prior-active-key");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(subscriptionFixture()));

    await connectApiKeyProvider(
      "elevenlabs",
      CANDIDATE_KEY,
      context(fetch),
      () => true,
      () => NOW + 1_000,
    );

    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: CANDIDATE_KEY,
      status: "active",
    });
  });

  test("marks only a saved-key invalid outcome as rejected", async () => {
    await saveProviderApiKey("elevenlabs", "saved-key");
    const savedCredential = await readProviderCredentialWithRevision(
      "elevenlabs",
    );

    await markStoredApiKeyRejectedForOutcome(
      "elevenlabs",
      savedCredential!.revision,
      {
        kind: "failure",
        category: "credential_invalid",
      },
    );

    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "saved-key",
      status: "rejected",
    });

    await saveProviderApiKey("elevenlabs", "replacement-key");
    const replacementCredential = await readProviderCredentialWithRevision(
      "elevenlabs",
    );
    await markStoredApiKeyRejectedForOutcome(
      "elevenlabs",
      replacementCredential!.revision,
      {
        kind: "failure",
        category: "credential_scope_required",
      },
    );
    expect((await readProviderCredential("elevenlabs"))?.status).toBe("active");
  });

  test("throws a fixed error when local persistence fails", async () => {
    vi.spyOn(browser.storage.local, "set").mockRejectedValueOnce(
      new Error(`storage rejected ${CANDIDATE_KEY}`),
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(subscriptionFixture()));

    let thrown: unknown;
    try {
      await connectApiKeyProvider(
        "elevenlabs",
        CANDIDATE_KEY,
        context(fetch),
        () => true,
        () => NOW + 1_000,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error("API key connection failed."));
    expect(String(thrown)).not.toContain(CANDIDATE_KEY);
  });

  test("restores the prior credential when state commit fails after candidate save", async () => {
    await connectApiKeyProvider(
      "elevenlabs",
      "prior-active-key",
      context(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture({ tier: "prior-plan" }))),
      ),
      () => true,
      () => NOW + 500,
    );
    const stateBefore = await loadState(NOW + 500);
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    let stateWriteFailed = false;
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (!stateWriteFailed && Object.hasOwn(value, "aiLimitsState")) {
          stateWriteFailed = true;
          throw new Error("state commit failed");
        }
        return storageSet(value);
      },
    );

    await expect(
      connectApiKeyProvider(
        "elevenlabs",
        CANDIDATE_KEY,
        context(
          vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValue(response(subscriptionFixture({ tier: "candidate" }))),
        ),
        () => true,
        () => NOW + 1_000,
      ),
    ).rejects.toThrow("API key connection failed.");

    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "prior-active-key",
      status: "active",
    });
    expect(await loadState(NOW + 1_000)).toEqual(stateBefore);
  });

  test("rollback preserves a rejection committed while candidate validation is pending", async () => {
    await saveProviderApiKey("elevenlabs", "prior-key");
    const stateBefore = await ensureState(NOW);
    const pendingResponse = deferred<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => pendingResponse.promise);

    const connecting = connectApiKeyProvider(
      "elevenlabs",
      CANDIDATE_KEY,
      context(fetch),
      () => true,
      () => NOW + 1_000,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const priorCredential = await readProviderCredentialWithRevision(
      "elevenlabs",
    );
    await markProviderCredentialRejectedIfRevision(
      "elevenlabs",
      priorCredential!.revision,
    );
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    let stateWriteFailed = false;
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (!stateWriteFailed && Object.hasOwn(value, "aiLimitsState")) {
          stateWriteFailed = true;
          throw new Error("state commit failed");
        }
        return storageSet(value);
      },
    );
    pendingResponse.resolve(response(subscriptionFixture()));

    await expect(connecting).rejects.toThrow("API key connection failed.");
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "prior-key",
      status: "rejected",
    });
    expect(await loadState(NOW + 1_000)).toEqual(stateBefore);
  });

  test("a failed pending state write rolls back after a newer connection supersedes it", async () => {
    await saveProviderApiKey("elevenlabs", "prior-key");
    const stateBefore = await ensureState(NOW);
    const stateWriteStarted = deferred<void>();
    const releaseStateWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (Object.hasOwn(value, "aiLimitsState")) {
          stateWriteStarted.resolve();
          await releaseStateWrite.promise;
          throw new Error("state commit failed");
        }
        return storageSet(value);
      },
    );
    const lifecycle = createApiKeyConnectionLifecycle();
    const first = lifecycle.connect(
      "elevenlabs",
      CANDIDATE_KEY,
      lifecycleContext(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture())),
      ),
      () => NOW + 1_000,
    );
    await stateWriteStarted.promise;

    const newerFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 401));
    const newer = lifecycle.connect(
      "elevenlabs",
      "failed-newer-key",
      lifecycleContext(newerFetch),
      () => NOW + 2_000,
    );
    await vi.waitFor(() => expect(newerFetch).toHaveBeenCalledOnce());
    releaseStateWrite.resolve();

    await expect(newer).resolves.toMatchObject({ result: "invalid_key" });
    await expect(first).rejects.toThrow("API key connection failed.");
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: "prior-key",
      status: "active",
    });
    expect(await loadState(NOW + 2_000)).toEqual(stateBefore);
  });

  test("a failed pending state write cannot roll back a newer same-key connection revision", async () => {
    await saveProviderApiKey("elevenlabs", "prior-key");
    const stateWriteStarted = deferred<void>();
    const releaseStateWrite = deferred<void>();
    const storageSet = browser.storage.local.set.bind(browser.storage.local);
    let firstStateWrite = true;
    vi.spyOn(browser.storage.local, "set").mockImplementation(
      async (value) => {
        if (firstStateWrite && Object.hasOwn(value, "aiLimitsState")) {
          firstStateWrite = false;
          stateWriteStarted.resolve();
          await releaseStateWrite.promise;
          throw new Error("state commit failed");
        }
        return storageSet(value);
      },
    );
    const lifecycle = createApiKeyConnectionLifecycle();
    const first = lifecycle.connect(
      "elevenlabs",
      CANDIDATE_KEY,
      lifecycleContext(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture({ tier: "stale" }))),
      ),
      () => NOW + 1_000,
    );
    await stateWriteStarted.promise;

    const newer = lifecycle.connect(
      "elevenlabs",
      CANDIDATE_KEY,
      lifecycleContext(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture({ tier: "latest" }))),
      ),
      () => NOW + 2_000,
    );
    releaseStateWrite.resolve();

    await expect(first).rejects.toThrow("API key connection failed.");
    await expect(newer).resolves.toMatchObject({ result: "connected" });
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: CANDIDATE_KEY,
      status: "active",
    });
    expect((await loadState(NOW + 2_000))?.providers[4]?.snapshot?.planLabel)
      .toBe("latest");
  });

  test("a superseded state commit cannot roll back a newer same-key credential revision", async () => {
    await saveProviderApiKey("elevenlabs", "prior-key");
    let currentChecks = 0;
    let newerSave: ReturnType<typeof saveProviderApiKeyIfCurrent> | undefined;
    const result = await connectApiKeyProvider(
      "elevenlabs",
      CANDIDATE_KEY,
      context(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(subscriptionFixture())),
      ),
      () => {
        currentChecks += 1;
        if (currentChecks === 3) {
          newerSave = saveProviderApiKeyIfCurrent(
            "elevenlabs",
            CANDIDATE_KEY,
            () => true,
          );
          return false;
        }
        return true;
      },
      () => NOW + 1_000,
    );
    const newerSaveResult = await newerSave;

    expect(result).toMatchObject({
      result: "temporary_error",
      report: {
        providers: {
          elevenlabs: { kind: "skipped", reason: "superseded" },
        },
      },
    });
    expect(await readProviderCredential("elevenlabs")).toEqual({
      kind: "api-key",
      value: CANDIDATE_KEY,
      status: "active",
    });
    expect(newerSaveResult?.saved).toBe(true);
    if (newerSaveResult?.saved) {
      expect(
        (await readProviderCredentialWithRevision("elevenlabs"))?.revision,
      ).toBe(newerSaveResult.revision);
    }
  });
});
