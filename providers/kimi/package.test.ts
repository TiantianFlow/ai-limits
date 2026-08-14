import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../../domain/instances";
import type { CollectionContext, CollectionResult } from "../types";
import { createKimiPackage } from "./package";

const instance: ProviderInstanceRecord = {
  id: "kimi:default",
  providerKind: "kimi",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: 1,
  history: [],
};

function services(interaction: "allowed" | "forbidden") {
  return {
    fetch: globalThis.fetch,
    now: 10,
    signal: new AbortController().signal,
    interaction,
  };
}

function adapterResult(collect: (context: CollectionContext) => Promise<CollectionResult>) {
  return { id: "kimi" as const, collect };
}

describe("Kimi provider package", () => {
  test("scheduled collection without a token never starts interactive recovery", async () => {
    const recoverAccessToken = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(recoverAccessToken).not.toHaveBeenCalled();
  });

  test("interactive collection waits for startup cleanup before one recovery", async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const order: string[] = [];
    const collect = vi.fn(async ({ accessToken }: CollectionContext) => {
      order.push(`collect:${accessToken}`);
      return { ok: true as const, snapshot: {
        providerKind: "kimi" as const,
        source: "web-session" as const,
        fetchedAt: 10,
        metrics: [],
      } };
    });
    const recoverAccessToken = vi.fn(async () => {
      order.push("recover");
      return "fresh-token";
    });
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn(() => cleanup),
      announceRecovery: vi.fn(() => order.push("announce")),
    });

    const startup = providerPackage.startup?.();
    const pending = providerPackage.collect(instance, services("allowed"));
    await Promise.resolve();
    expect(recoverAccessToken).not.toHaveBeenCalled();
    finishCleanup?.();

    await expect(pending).resolves.toMatchObject({ ok: true });
    await startup;
    expect(order).toEqual(["announce", "recover", "collect:fresh-token"]);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
  });

  test("retries once only when an unauthorized attempt observes a changed token", async () => {
    const collect = vi
      .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValueOnce({
        ok: false,
        deferred: { reason: "session_required" },
      })
      .mockResolvedValueOnce({
        ok: false,
        deferred: { reason: "session_required" },
      });
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("stale-token"),
      findPageAccessToken: vi.fn().mockResolvedValue("fresh-token"),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(collect).toHaveBeenCalledTimes(2);
    expect(collect.mock.calls.map(([context]) => context.accessToken)).toEqual([
      "stale-token",
      "fresh-token",
    ]);
  });

  test("does not retry when recovery repeats the rejected token", async () => {
    const collect = vi.fn(async () => ({
      ok: false as const,
      deferred: { reason: "session_required" as const },
    }));
    const recoverAccessToken = vi.fn().mockResolvedValue("same-token");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("same-token"),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });

    await expect(
      providerPackage.collect(instance, services("allowed")),
    ).resolves.toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
  });
});
