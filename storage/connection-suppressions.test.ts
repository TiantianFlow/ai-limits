import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearProviderConnectionSuppressions,
  isProviderConnectionSuppressed,
  replaceProviderConnectionSuppressions,
  setProviderConnectionSuppressed,
} from "./connection-suppressions";

beforeEach(async () => {
  await browser.storage.local.clear();
});

describe("provider connection suppressions", () => {
  test("stores only provider IDs and updates providers independently", async () => {
    await setProviderConnectionSuppressed("chatgpt", true);
    await setProviderConnectionSuppressed("elevenlabs", true);

    await expect(isProviderConnectionSuppressed("chatgpt")).resolves.toBe(true);
    await expect(isProviderConnectionSuppressed("elevenlabs")).resolves.toBe(true);

    await clearProviderConnectionSuppressions(["chatgpt"]);
    await expect(isProviderConnectionSuppressed("chatgpt")).resolves.toBe(false);
    await expect(isProviderConnectionSuppressed("elevenlabs")).resolves.toBe(true);
    expect(JSON.stringify(await browser.storage.local.get(null))).toBe(
      '{"aiLimitsConnectionSuppressions":["elevenlabs"]}',
    );
  });

  test("atomically replaces suppression state after a partial Delete all cleanup", async () => {
    await setProviderConnectionSuppressed("chatgpt", true);
    await replaceProviderConnectionSuppressions(["claude", "kimi"]);

    await expect(isProviderConnectionSuppressed("chatgpt")).resolves.toBe(false);
    await expect(isProviderConnectionSuppressed("claude")).resolves.toBe(true);
    await expect(isProviderConnectionSuppressed("kimi")).resolves.toBe(true);
  });

  test("a rejected suppress write does not leave an unpersisted intent authoritative", async () => {
    vi.spyOn(browser.storage.local, "set").mockRejectedValueOnce(
      new Error("suppression write failed"),
    );

    await expect(
      setProviderConnectionSuppressed("chatgpt", true),
    ).rejects.toThrow("suppression write failed");
    await expect(isProviderConnectionSuppressed("chatgpt")).resolves.toBe(false);
  });

  test("a rejected clear write restores the persisted suppression authority", async () => {
    await setProviderConnectionSuppressed("chatgpt", true);
    vi.spyOn(browser.storage.local, "remove").mockRejectedValueOnce(
      new Error("suppression clear failed"),
    );

    await expect(
      setProviderConnectionSuppressed("chatgpt", false),
    ).rejects.toThrow("suppression clear failed");
    await expect(isProviderConnectionSuppressed("chatgpt")).resolves.toBe(true);
  });
});
