import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/model";
import {
  initializeCredentialVault,
  saveApiKeyIfCurrent,
} from "../storage/credentials";
import { isProviderConnected, isProviderRefreshEligible } from "./provider-access";

const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";

function newApi(
  id: ProviderInstanceId,
  connectionRevision?: string,
): ProviderInstanceRecord {
  return {
    id,
    providerKind: "newapi",
    config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
    ...(connectionRevision ? { connectionRevision } : {}),
    access: "granted",
    createdAt: 1,
    history: [],
  };
}

function browserSession(): ProviderInstanceRecord {
  return {
    id: "chatgpt:default",
    providerKind: "chatgpt",
    config: { kind: "fixed" },
    access: "granted",
    createdAt: 1,
    history: [],
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialVault();
  vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
});

describe("provider instance access", () => {
  test("treats a browser-session instance as connected and eligible with exact permission", async () => {
    await expect(isProviderConnected(browserSession())).resolves.toBe(true);
    await expect(isProviderRefreshEligible(browserSession())).resolves.toBe(true);
    expect(browser.permissions.contains).toHaveBeenCalledWith({
      origins: ["https://chatgpt.com/*"],
    });
  });

  test("fails closed when instance permission is absent", async () => {
    vi.mocked(browser.permissions.contains).mockResolvedValue(false as never);
    await expect(isProviderConnected(newApi(FIRST))).resolves.toBe(false);
    await expect(isProviderRefreshEligible(newApi(FIRST))).resolves.toBe(false);
  });

  test("requires an active credential for refresh but retains rejected connection identity", async () => {
    const saved = await saveApiKeyIfCurrent(
      FIRST,
      "rejected-secret",
      () => true,
      "rejected",
    );
    expect(saved.saved).toBe(true);

    if (!saved.saved) throw new Error("fixture save failed");
    await expect(isProviderConnected(newApi(FIRST, saved.revision)))
      .resolves.toBe(true);
    await expect(isProviderRefreshEligible(newApi(FIRST, saved.revision)))
      .resolves.toBe(false);
  });

  test("keeps same-kind sibling credentials isolated", async () => {
    const first = await saveApiKeyIfCurrent(FIRST, "active-secret", () => true);
    const second = await saveApiKeyIfCurrent(
      SECOND,
      "rejected-secret",
      () => true,
      "rejected",
    );
    if (!first.saved || !second.saved) throw new Error("fixture save failed");

    await expect(isProviderRefreshEligible(newApi(FIRST, first.revision)))
      .resolves.toBe(true);
    await expect(isProviderRefreshEligible(newApi(SECOND, second.revision)))
      .resolves.toBe(false);
  });

  test("fails closed when a stored credential belongs to another connection revision", async () => {
    const saved = await saveApiKeyIfCurrent(
      FIRST,
      "replacement-secret",
      () => true,
    );
    if (!saved.saved) throw new Error("fixture save failed");

    const stale = newApi(FIRST, "550e8400-e29b-41d4-a716-446655440090");
    await expect(isProviderConnected(stale)).resolves.toBe(false);
    await expect(isProviderRefreshEligible(stale)).resolves.toBe(false);
  });
});
