import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/instances";
import type { CollectionResult, ProviderPackage } from "../providers/types";
import {
  initializeCredentialVault,
  readCredentialWithRevision,
  saveApiKeyIfCurrent,
} from "../storage/credential-vault";
import {
  createApiKeyConnectionLifecycle,
  markStoredApiKeyRejectedForOutcome,
} from "./api-key-connection";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";

function instance(id: ProviderInstanceId): ProviderInstanceRecord {
  return {
    id,
    providerKind: "newapi",
    config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
    access: "granted",
    createdAt: NOW,
    history: [],
  };
}

function success(): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "newapi",
      source: "api-key",
      fetchedAt: NOW,
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

function providerPackage(collect: ProviderPackage["collect"]): ProviderPackage {
  return {
    kind: "newapi",
    cardinality: "multiple",
    credentialKind: "api-key",
    normalizeConfig: (value) => value as ProviderInstanceRecord["config"],
    requiredPermissions: () => undefined,
    collect,
  };
}

const services = {
  fetch: vi.fn() as unknown as typeof globalThis.fetch,
  now: NOW,
  interaction: "allowed" as const,
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialVault();
});

describe("API-key instance connection lifecycle", () => {
  test.each([
    [{ ok: false, health: { kind: "credential_invalid" } }, "invalid_key"],
    [
      { ok: false, health: { kind: "credential_scope_required" } },
      "insufficient_scope",
    ],
    [{ ok: false, health: { kind: "provider_changed" } }, "invalid_site"],
    [{ ok: false, health: { kind: "temporary_error" } }, "temporary_error"],
  ] as const)("maps a package validation outcome to %s", async (result, status) => {
    const lifecycle = createApiKeyConnectionLifecycle();
    const validation = await lifecycle.connect(
      instance(FIRST),
      providerPackage(async () => result),
      "candidate",
      services,
      () => NOW,
    );

    expect(validation.result).toBe(status);
  });

  test("passes only the candidate credential to its selected instance package", async () => {
    const collect = vi.fn(async () => success());
    const validation = await createApiKeyConnectionLifecycle().connect(
      instance(FIRST),
      providerPackage(collect),
      "candidate-secret",
      services,
      () => NOW,
    );

    expect(validation.result).toBe("connected");
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ id: FIRST }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { kind: "api-key", value: "candidate-secret" },
    );
  });

  test("invalidating one sibling does not supersede another sibling connection", async () => {
    const finish = new Map<ProviderInstanceId, (value: CollectionResult) => void>();
    const collect = vi.fn(
      (selected: ProviderInstanceRecord) =>
        new Promise<CollectionResult>((resolve) => finish.set(selected.id, resolve)),
    );
    const lifecycle = createApiKeyConnectionLifecycle();
    const first = lifecycle.connect(
      instance(FIRST),
      providerPackage(collect),
      "first-secret",
      services,
      () => NOW,
    );
    const second = lifecycle.connect(
      instance(SECOND),
      providerPackage(collect),
      "second-secret",
      services,
      () => NOW,
    );
    await vi.waitFor(() => expect(finish.size).toBe(2));

    lifecycle.invalidateInstance(FIRST);
    finish.get(FIRST)?.(success());
    finish.get(SECOND)?.(success());

    await expect(first).resolves.toMatchObject({
      result: "temporary_error",
      outcome: { kind: "skipped", reason: "superseded" },
    });
    await expect(second).resolves.toMatchObject({ result: "connected" });
  });

  test("a newer candidate supersedes only the previous generation of the same instance", async () => {
    const finish: Array<(value: CollectionResult) => void> = [];
    const pkg = providerPackage(
      () => new Promise<CollectionResult>((resolve) => finish.push(resolve)),
    );
    const lifecycle = createApiKeyConnectionLifecycle();
    const oldCandidate = lifecycle.connect(
      instance(FIRST), pkg, "old", services, () => NOW,
    );
    const newCandidate = lifecycle.connect(
      instance(FIRST), pkg, "new", services, () => NOW,
    );
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[0]?.(success());
    finish[1]?.(success());

    await expect(oldCandidate).resolves.toMatchObject({
      outcome: { kind: "skipped", reason: "superseded" },
    });
    await expect(newCandidate).resolves.toMatchObject({ result: "connected" });
  });

  test("credential revision rejection is isolated to the selected instance", async () => {
    const first = await saveApiKeyIfCurrent(FIRST, "first-secret", () => true);
    const second = await saveApiKeyIfCurrent(SECOND, "second-secret", () => true);
    expect(first.saved && second.saved).toBe(true);
    if (!first.saved) throw new Error("missing test credential");

    await markStoredApiKeyRejectedForOutcome(FIRST, first.revision, {
      kind: "failure",
      category: "credential_invalid",
    });

    await expect(readCredentialWithRevision(FIRST)).resolves.toMatchObject({
      status: "rejected",
      value: "first-secret",
    });
    await expect(readCredentialWithRevision(SECOND)).resolves.toMatchObject({
      status: "active",
      value: "second-secret",
    });
  });
});
