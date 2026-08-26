import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../../domain/model";
import type { CollectionContext, CollectionResult } from "../types";
import { createGrokPackage } from "./package";
import type { GrokPageProbe } from "./page-session";

const NOW = 1_800_000_000_000;

const instance: ProviderInstanceRecord = {
  id: "grok:default",
  providerKind: "grok",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: 1,
  history: [],
};

function services(interaction: "allowed" | "forbidden") {
  return {
    fetch: vi.fn<typeof globalThis.fetch>(),
    now: NOW,
    signal: new AbortController().signal,
    interaction,
  };
}

function successfulCollection(): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "grok",
      source: "web-session",
      fetchedAt: NOW,
      metrics: [],
    },
  };
}

const pageRead: GrokPageProbe = {
  kind: "read",
  session: {
    ok: true,
    status: 200,
    contentType: "application/json",
    json: { status: "authenticated", session: { userId: "user-test" } },
  },
  pool: { ok: false, status: 404, contentType: "application/json" },
  rateLimits: {
    fast: { ok: false, status: 404, contentType: "application/json" },
    expert: { ok: false, status: 404, contentType: "application/json" },
    heavy: { ok: false, status: 404, contentType: "application/json" },
    auto: { ok: false, status: 404, contentType: "application/json" },
  },
  subscriptions: {
    ok: true,
    status: 200,
    contentType: "application/json",
    json: { subscriptions: [] },
  },
};

describe("Grok provider package", () => {
  test("startup cleanup failure does not block package registration", async () => {
    const collect = vi.fn<(context: CollectionContext) => Promise<CollectionResult>>();
    const findPageSession = vi.fn();
    const providerPackage = createGrokPackage({
      collect,
      findPageSession,
      cleanupAbandonedOwnedTab: vi.fn().mockRejectedValue(new Error("cleanup-private")),
    });

    await expect(providerPackage.startup?.()).resolves.toBeUndefined();
    expect(findPageSession).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  test("page-probe failures never fall back to a background grok.com fetch", async () => {
    const collect = vi.fn<(context: CollectionContext) => Promise<CollectionResult>>();
    const runtime = services("allowed");
    const providerPackage = createGrokPackage({
      collect,
      findPageSession: vi.fn().mockResolvedValue({
        kind: "inject_empty",
        detail: "injection.result was null",
      }),
    });

    await expect(providerPackage.collect(instance, runtime)).resolves.toEqual({
      ok: false,
      health: {
        kind: "provider_changed",
        message: "page-probe: inject_empty: injection.result was null",
      },
    });
    expect(collect).not.toHaveBeenCalled();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  test("scheduled collection reuses existing tabs and never opens an owned tab", async () => {
    const collect = vi.fn<(context: CollectionContext) => Promise<CollectionResult>>();
    const findPageSession = vi.fn().mockResolvedValue({ kind: "no_tab" });
    const providerPackage = createGrokPackage({ collect, findPageSession });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual({
      ok: false,
      health: {
        kind: "temporary_error",
        message: "page-probe: no_tab",
      },
    });
    expect(findPageSession).toHaveBeenCalledWith({ allowOwnedTab: false });
    expect(collect).not.toHaveBeenCalled();
  });

  test("interactive collection may open an owned grok.com tab when none is open", async () => {
    const collect = vi
      .fn<(context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValue(successfulCollection());
    const findPageSession = vi.fn().mockResolvedValue(pageRead);
    const providerPackage = createGrokPackage({ collect, findPageSession });
    const runtime = services("allowed");

    await expect(providerPackage.collect(instance, runtime)).resolves.toEqual(
      successfulCollection(),
    );
    expect(findPageSession).toHaveBeenCalledWith({ allowOwnedTab: true });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(runtime.fetch).not.toHaveBeenCalled();
    expect(collect.mock.calls[0]?.[0]?.fetch).not.toBe(runtime.fetch);
  });
});
