import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../domain/instances";
import {
  PERMISSION_INTENT_SWEEP_ALARM,
  createPermissionIntentStore,
} from "./permission-intents";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const INSTANCE = "newapi:550e8400-e29b-41d4-a716-446655440000";

const candidate: ProviderInstanceRecord = {
  id: INSTANCE,
  providerKind: "newapi",
  config: { kind: "dynamic-origin", baseUrl: "https://relay.example/gateway" },
  access: "required",
  createdAt: NOW,
  history: [],
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
  vi.spyOn(browser.alarms, "create");
  vi.spyOn(browser.alarms, "clear");
});

describe("pending permission intent storage", () => {
  test("persists only a bounded non-secret candidate before permission request and survives restart", async () => {
    const store = createPermissionIntentStore({
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
    });

    const intent = await store.create(candidate);
    expect(intent).toMatchObject({
      id: "550e8400-e29b-41d4-a716-446655440099",
      phase: "pending",
      candidate: expect.objectContaining({ id: INSTANCE }),
    });
    expect(await browser.storage.session.get(null)).toEqual({});
    expect(JSON.stringify(await browser.storage.local.get(null))).not.toMatch(
      /apiKey|credential|secret|revision|lease/i,
    );
    expect(browser.alarms.create).toHaveBeenCalledWith(
      PERMISSION_INTENT_SWEEP_ALARM,
      { when: expect.any(Number) },
    );

    await browser.storage.session.clear();
    const restarted = createPermissionIntentStore({ clock: () => NOW + 1 });
    await expect(restarted.listActiveCandidates()).resolves.toEqual([
      expect.objectContaining({ id: INSTANCE }),
    ]);
  });

  test("records request result, allows one claim, and removes the owner on finish", async () => {
    const store = createPermissionIntentStore({
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
    });
    const { id } = await store.create(candidate);

    await expect(store.resolveRequest(id, true)).resolves.toMatchObject({
      phase: "granted",
    });
    await expect(store.claim(id)).resolves.toMatchObject({
      candidate: expect.objectContaining({ id: INSTANCE }),
    });
    await expect(store.claim(id)).resolves.toBeUndefined();
    await store.finish(id);
    await expect(store.listActiveCandidates()).resolves.toEqual([]);
    expect(browser.alarms.clear).toHaveBeenCalledWith(
      PERMISSION_INTENT_SWEEP_ALARM,
    );
  });

  test("retains abandoned and expired candidates until exact permission cleanup completes", async () => {
    let now = NOW;
    const store = createPermissionIntentStore({
      clock: () => now,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
      ttlMs: 100,
    });
    const { id } = await store.create(candidate);
    const abandoned = await store.abandon(id);
    expect(abandoned).toMatchObject({
      candidate: expect.objectContaining({ id: INSTANCE }),
    });
    await expect(store.listActiveCandidates()).resolves.toEqual([]);
    expect(JSON.stringify(await browser.storage.local.get(null))).toContain(INSTANCE);
    if (!abandoned) throw new Error("missing cleanup evidence");
    await store.completeCleanup(abandoned.id);

    await store.create(candidate);
    now += 101;
    await expect(store.sweepExpired()).resolves.toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ id: INSTANCE }),
      }),
    ]);
    await expect(store.listActiveCandidates()).resolves.toEqual([]);
    expect(JSON.stringify(await browser.storage.local.get(null))).toContain(
      INSTANCE,
    );
  });

  test("persists cleanup evidence before surfacing alarm scheduling failure", async () => {
    vi.mocked(browser.alarms.create).mockRejectedValueOnce(
      new Error("alarm unavailable"),
    );
    const store = createPermissionIntentStore({
      clock: () => NOW,
      randomUUID: () => "550e8400-e29b-41d4-a716-446655440099",
      ttlMs: 100,
    });

    await expect(store.create(candidate)).rejects.toThrow("alarm unavailable");
    expect(JSON.stringify(await browser.storage.local.get(null))).toContain(
      INSTANCE,
    );

    await browser.storage.session.clear();
    const restarted = createPermissionIntentStore({ clock: () => NOW + 101 });
    await expect(restarted.sweepExpired()).resolves.toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ id: INSTANCE }),
      }),
    ]);
  });

  test("refuses a seventeenth active intent instead of evicting an owner", async () => {
    let sequence = 0;
    const store = createPermissionIntentStore({
      clock: () => NOW,
      randomUUID: () =>
        `550e8400-e29b-41d4-a716-${(++sequence).toString(16).padStart(12, "0")}`,
    });
    for (let index = 0; index < 16; index += 1) {
      await store.create(candidate);
    }

    await expect(store.create(candidate)).rejects.toThrow(
      "Too many pending permission intents.",
    );
    await expect(store.listActiveCandidates()).resolves.toHaveLength(16);
  });

  test("rejects durable candidates whose exact config does not match their package", async () => {
    await browser.storage.local.set({
      aiLimitsPermissionIntents: {
        version: 1,
        intents: [
          {
            id: "550e8400-e29b-41d4-a716-446655440099",
            phase: "pending",
            candidate: {
              id: INSTANCE,
              providerKind: "newapi",
              config: { kind: "fixed" },
              createdAt: NOW,
            },
            expiresAt: NOW + 100,
          },
        ],
      },
    });

    const store = createPermissionIntentStore({ clock: () => NOW });
    await expect(store.listActiveCandidates()).resolves.toEqual([]);
  });
});
