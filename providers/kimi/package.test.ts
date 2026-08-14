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

function successfulCollection(): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "kimi",
      source: "web-session",
      fetchedAt: 10,
      metrics: [],
    },
  };
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

  test.each(["cookie", "page"] as const)(
    "scheduled collection isolates a rejected %s token resolver without recovery",
    async (rejectedResolver) => {
      const rawError = `${rejectedResolver}-resolver-secret`;
      const recoverAccessToken = vi.fn();
      const announceRecovery = vi.fn();
      const providerPackage = createKimiPackage({
        adapter: adapterResult(vi.fn()),
        getCookieToken:
          rejectedResolver === "cookie"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        findPageAccessToken:
          rejectedResolver === "page"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
        cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
        announceRecovery,
      });

      const result = await providerPackage.collect(
        instance,
        services("forbidden"),
      );

      expect(result).toEqual({
        ok: false,
        deferred: { reason: "session_required" },
      });
      expect(recoverAccessToken).not.toHaveBeenCalled();
      expect(announceRecovery).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(rawError);
    },
  );

  test.each(["cookie", "page"] as const)(
    "interactive collection isolates a rejected %s token resolver and performs one bounded recovery",
    async (rejectedResolver) => {
      const rawError = `${rejectedResolver}-resolver-secret`;
      const collect = vi.fn().mockResolvedValue(successfulCollection());
      const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
      const providerPackage = createKimiPackage({
        adapter: adapterResult(collect),
        getCookieToken:
          rejectedResolver === "cookie"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        findPageAccessToken:
          rejectedResolver === "page"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
        cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
        announceRecovery: vi.fn(),
      });

      const result = await providerPackage.collect(
        instance,
        services("allowed"),
      );

      expect(result).toMatchObject({ ok: true });
      expect(recoverAccessToken).toHaveBeenCalledTimes(1);
      expect(collect).toHaveBeenCalledTimes(1);
      expect(collect.mock.calls[0]?.[0].accessToken).toBe("fresh-token");
      expect(JSON.stringify(result)).not.toContain(rawError);
    },
  );

  test.each([
    { interaction: "forbidden" as const, recoveryCalls: 0 },
    { interaction: "allowed" as const, recoveryCalls: 1 },
  ])(
    "$interaction collection isolates a rejected page reread after unauthorized usage",
    async ({ interaction, recoveryCalls }) => {
      const rawError = "page-reread-secret";
      const collect = vi
        .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
        .mockResolvedValueOnce({
          ok: false,
          deferred: { reason: "session_required" },
        })
        .mockResolvedValueOnce(successfulCollection());
      const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
      const providerPackage = createKimiPackage({
        adapter: adapterResult(collect),
        getCookieToken: vi.fn().mockResolvedValue("stale-token"),
        findPageAccessToken: vi
          .fn()
          .mockRejectedValue(new Error(rawError)),
        recoverAccessToken,
        cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
        announceRecovery: vi.fn(),
      });

      const result = await providerPackage.collect(
        instance,
        services(interaction),
      );

      expect(recoverAccessToken).toHaveBeenCalledTimes(recoveryCalls);
      expect(result).toEqual(
        interaction === "forbidden"
          ? {
              ok: false,
              deferred: { reason: "session_required" },
            }
          : successfulCollection(),
      );
      expect(JSON.stringify(result)).not.toContain(rawError);
    },
  );

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
    expect(order).toEqual([]);
    finishCleanup?.();

    await expect(pending).resolves.toMatchObject({ ok: true });
    await startup;
    expect(order).toEqual(["announce", "recover", "collect:fresh-token"]);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
  });

  test("aborting while startup cleanup is pending does not announce or begin recovery", async () => {
    const cleanup = new Promise<void>(() => undefined);
    const controller = new AbortController();
    const recoverAccessToken = vi.fn();
    const announceRecovery = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn(() => cleanup),
      announceRecovery,
    });

    void providerPackage.startup?.();
    const pending = providerPackage.collect(instance, {
      ...services("allowed"),
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
    expect(announceRecovery).not.toHaveBeenCalled();
    expect(recoverAccessToken).not.toHaveBeenCalled();
  });

  test("public startup contains cleanup failure while collection remains gated", async () => {
    const rawError = "startup-cleanup-secret";
    const recoverAccessToken = vi.fn();
    const announceRecovery = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi
        .fn()
        .mockRejectedValue(new Error(rawError)),
      announceRecovery,
    });

    await expect(providerPackage.startup?.()).resolves.toBeUndefined();

    const result = await providerPackage.collect(
      instance,
      services("allowed"),
    );

    expect(result).toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
    expect(announceRecovery).not.toHaveBeenCalled();
    expect(recoverAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(rawError);
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
