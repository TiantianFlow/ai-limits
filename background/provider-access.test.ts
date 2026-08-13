import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  initializeCredentialStorage,
  markProviderCredentialRejected,
  saveProviderApiKey,
} from "../storage/credentials";
import { setProviderConnectionSuppressed } from "../storage/connection-suppressions";
import {
  isProviderConnected,
  isProviderRefreshEligible,
} from "./provider-access";

beforeEach(async () => {
  vi.restoreAllMocks();
  await browser.storage.local.clear();
  Object.assign(browser.storage.local, {
    setAccessLevel: vi.fn(async () => undefined),
  });
  await initializeCredentialStorage();
});

describe("provider-aware access", () => {
  test.each(["chatgpt", "claude", "kimi", "cursor"] as const)(
    "keeps browser-session connection and refresh eligibility in permission parity for %s",
    async (providerId) => {
      vi.spyOn(browser.permissions, "contains")
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never)
        .mockResolvedValueOnce(false as never);

      await expect(isProviderConnected(providerId)).resolves.toBe(true);
      await expect(isProviderRefreshEligible(providerId)).resolves.toBe(true);
      await expect(isProviderConnected(providerId)).resolves.toBe(false);
      await expect(isProviderRefreshEligible(providerId)).resolves.toBe(false);
    },
  );

  test("does not connect an API-key provider from host permission alone", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);

    await expect(isProviderConnected("elevenlabs")).resolves.toBe(false);
    await expect(isProviderRefreshEligible("elevenlabs")).resolves.toBe(false);
  });

  test("connects and refreshes an API-key provider only with permission and an active key", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    await saveProviderApiKey("elevenlabs", "active-test-key");

    await expect(isProviderConnected("elevenlabs")).resolves.toBe(true);
    await expect(isProviderRefreshEligible("elevenlabs")).resolves.toBe(true);
  });

  test("keeps a rejected-key provider connected while stopping requests", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    await saveProviderApiKey("elevenlabs", "rejected-test-key");
    await markProviderCredentialRejected("elevenlabs");

    await expect(isProviderConnected("elevenlabs")).resolves.toBe(true);
    await expect(isProviderRefreshEligible("elevenlabs")).resolves.toBe(false);
  });

  test.each(["chatgpt", "elevenlabs"] as const)(
    "keeps a locally disconnected %s provider ineligible until explicit suppression clearing",
    async (providerId) => {
      vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
      if (providerId === "elevenlabs") {
        await saveProviderApiKey(providerId, "active-test-key");
      }
      await setProviderConnectionSuppressed(providerId, true);

      await expect(isProviderConnected(providerId)).resolves.toBe(false);
      await expect(isProviderRefreshEligible(providerId)).resolves.toBe(false);

      await setProviderConnectionSuppressed(providerId, false);
      await expect(isProviderConnected(providerId)).resolves.toBe(true);
      await expect(isProviderRefreshEligible(providerId)).resolves.toBe(true);
    },
  );
});
