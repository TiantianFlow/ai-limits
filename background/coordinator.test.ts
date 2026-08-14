import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/model";
import type { CollectionResult, ProviderPackage } from "../providers/types";
import {
  connectionRepository,
  loadInstanceAppState,
} from "../storage/repository";
import {
  collectProviderOutcome,
  commitProviderOutcome,
  refreshProviderInstance,
} from "./coordinator";
import { projectAppViewState } from "./view-state";

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

function collection(usedRatio = 0.25): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "chatgpt",
      source: "api-key",
      fetchedAt: 1,
      metrics: [
        {
          type: "quota",
          id: "primary",
          label: "Primary",
          scope: "general",
          usedRatio,
        },
      ],
    },
  };
}

function providerPackage(
  collect: ProviderPackage["collect"],
): ProviderPackage {
  return {
    kind: "newapi",
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "dynamic-origin",
    normalizeConfig: (value) => value as ProviderInstanceRecord["config"],
    requiredPermissions: () => undefined,
    collect,
  };
}

function services() {
  return {
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
    now: NOW,
    signal: new AbortController().signal,
    interaction: "allowed" as const,
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
});

describe("instance coordinator", () => {
  test("delegates through the package with the selected instance and credential", async () => {
    const selected = instance(FIRST);
    const collect = vi.fn(async () => collection());

    const result = await collectProviderOutcome(
      providerPackage(collect),
      selected,
      services(),
      "manual_provider",
      { kind: "api-key", value: "first-secret" },
      () => NOW + 10,
    );

    expect(collect).toHaveBeenCalledWith(
      selected,
      expect.objectContaining({ interaction: "allowed" }),
      { kind: "api-key", value: "first-secret" },
    );
    expect(result).toEqual({
      finishedAt: NOW + 10,
      outcome: expect.objectContaining({
        kind: "success",
        snapshot: expect.objectContaining({
          providerKind: "newapi",
          fetchedAt: NOW + 10,
        }),
      }),
    });
  });

  test("contains package exceptions and adds scheduled temporary backoff", async () => {
    const collect = vi.fn(async () => {
      throw new Error("raw provider response");
    });

    const result = await collectProviderOutcome(
      providerPackage(collect),
      instance(FIRST),
      services(),
      "scheduled",
      undefined,
      () => NOW + 20,
    );

    expect(result).toEqual({
      finishedAt: NOW + 20,
      outcome: {
        kind: "failure",
        category: "temporary_error",
        retryAt: NOW + 20 + 15 * 60 * 1_000,
      },
    });
  });

  test("commits usage and history only to the selected same-kind sibling", async () => {
    await connectionRepository.create(instance(FIRST));
    await connectionRepository.create(instance(SECOND));

    const outcome = await refreshProviderInstance(
      providerPackage(async () => collection(0.6)),
      instance(FIRST),
      services(),
      "manual_provider",
      () => true,
      { kind: "api-key", value: "first-secret" },
      () => NOW + 30,
    );

    expect(outcome.kind).toBe("success");
    const state = await loadInstanceAppState();
    expect(state.instances.find(({ id }) => id === FIRST)?.history).toHaveLength(1);
    expect(state.instances.find(({ id }) => id === SECOND)?.history).toHaveLength(0);
  });

  test("does not commit an invalidated generation", async () => {
    await connectionRepository.create(instance(FIRST));
    const shouldCommit = vi.fn(() => false);

    const outcome = await commitProviderOutcome(
      FIRST,
      { kind: "failure", category: "signed_out" },
      "manual_provider",
      NOW,
      NOW + 1,
      shouldCommit,
    );

    expect(outcome).toEqual({ kind: "skipped", reason: "superseded" });
    expect((await connectionRepository.get(FIRST))?.lastAttempt).toBeUndefined();
  });

  test("persists validated neutral recovery guidance and projects it after re-read", async () => {
    await connectionRepository.create(instance(FIRST));

    await refreshProviderInstance(
      providerPackage(async () => ({
        ok: false,
        health: {
          kind: "temporary_error",
          message: "Open the provider and retry.",
          guidance: "retry_session",
        },
      })),
      instance(FIRST),
      services(),
      "manual_provider",
      () => true,
      undefined,
      () => NOW + 40,
    );

    const restartedState = await loadInstanceAppState();
    expect(restartedState.instances[0]?.lastAttempt?.outcome).toEqual({
      kind: "failure",
      category: "temporary_error",
      message: "AI Limits could not refresh this provider. Try again later.",
      guidance: "retry_session",
    });
    expect(projectAppViewState(restartedState).instances[0]?.lastAttempt?.outcome)
      .toEqual({
        kind: "failure",
        category: "temporary_error",
        message: "AI Limits could not refresh this provider. Try again later.",
        guidance: "retry_session",
      });
  });

  test("drops malformed guidance while retaining a sanitized generic failure", async () => {
    const result = await collectProviderOutcome(
      providerPackage(async () => ({
        ok: false,
        health: {
          kind: "temporary_error",
          message: "token=synthetic-secret",
          guidance: "<img src=x onerror=synthetic-secret>",
        },
      } as unknown as CollectionResult)),
      instance(FIRST),
      services(),
      "manual_provider",
      undefined,
      () => NOW + 50,
    );

    expect(result.outcome).toEqual({
      kind: "failure",
      category: "temporary_error",
      message: "AI Limits could not refresh this provider. Try again later.",
    });
  });

  test("keeps generic failures guidance-free", async () => {
    const result = await collectProviderOutcome(
      providerPackage(async () => ({
        ok: false,
        health: { kind: "signed_out" },
      })),
      instance(FIRST),
      services(),
      "manual_provider",
      undefined,
      () => NOW + 60,
    );

    expect(result.outcome).toEqual({ kind: "failure", category: "signed_out" });
  });

  test("skips a result if the selected instance disappears before commit", async () => {
    const outcome = await commitProviderOutcome(
      FIRST,
      { kind: "failure", category: "signed_out" },
      "manual_provider",
      NOW,
      NOW + 1,
      () => true,
    );

    expect(outcome).toEqual({ kind: "skipped", reason: "superseded" });
  });
});
