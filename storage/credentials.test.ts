import { beforeEach, describe, expect, test, vi } from "vitest";

type Credentials = typeof import("./credentials");

let credentials: Credentials;
let setAccessLevel: ReturnType<typeof vi.fn>;

function localStorageContents(): Promise<Record<string, unknown>> {
  return browser.storage.local.get(null) as Promise<Record<string, unknown>>;
}

async function credentialStorageKey(): Promise<string> {
  const keys = Object.keys(await localStorageContents());
  const credentialKeys = keys.filter((key) => key !== "unrelated");
  expect(credentialKeys).toHaveLength(1);
  return credentialKeys[0]!;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await browser.storage.local.clear();
  setAccessLevel = vi.fn(async () => undefined);
  Object.assign(browser.storage.local, { setAccessLevel });
  credentials = await import("./credentials");
});

describe("credential storage", () => {
  test("fails closed before trusted-context storage initialization", async () => {
    await credentials.saveProviderApiKey("elevenlabs", "api-key");

    expect(await credentials.readProviderCredential("elevenlabs")).toBeUndefined();
    expect(await localStorageContents()).toEqual({});
  });

  test("normalizes only an exact version-one credential record", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "api-key");
    const storageKey = await credentialStorageKey();

    await browser.storage.local.set({
      [storageKey]: {
        version: 2,
        providers: {
          elevenlabs: { kind: "api-key", value: "api-key", status: "active" },
        },
      },
    });

    await expect(credentials.readProviderCredential("elevenlabs")).resolves.toBeUndefined();
  });

  test("trims a bounded nonempty API key before persisting it", async () => {
    await credentials.initializeCredentialStorage();

    await credentials.saveProviderApiKey("elevenlabs", "  api-key  ");
    await credentials.saveProviderApiKey("elevenlabs", "   ");
    await credentials.saveProviderApiKey("elevenlabs", "x".repeat(4_097));

    await expect(credentials.readProviderCredential("elevenlabs")).resolves.toEqual({
      kind: "api-key",
      value: "api-key",
      status: "active",
    });
  });

  test("stores rejected credentials and replaces them with a new active key", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "first", "rejected");
    await credentials.saveProviderApiKey("elevenlabs", "second");
    await credentials.markProviderCredentialRejected("elevenlabs");

    await expect(credentials.readProviderCredential("elevenlabs")).resolves.toEqual({
      kind: "api-key",
      value: "second",
      status: "rejected",
    });
  });

  test("deletes one provider credential without deleting unrelated local storage", async () => {
    await browser.storage.local.set({ unrelated: "keep" });
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "api-key");

    await credentials.deleteProviderCredential("elevenlabs");

    expect(await credentials.readProviderCredential("elevenlabs")).toBeUndefined();
    expect(await browser.storage.local.get("unrelated")).toEqual({ unrelated: "keep" });
    expect(Object.keys(await localStorageContents())).toEqual(["unrelated", await credentialStorageKey()]);
  });

  test("deletes every credential while preserving unrelated local storage", async () => {
    await browser.storage.local.set({ unrelated: "keep" });
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "api-key");

    await credentials.deleteAllProviderCredentials();

    expect(await credentials.readProviderCredential("elevenlabs")).toBeUndefined();
    expect(await browser.storage.local.get("unrelated")).toEqual({ unrelated: "keep" });
    expect(Object.keys(await localStorageContents())).toEqual(["unrelated", await credentialStorageKey()]);
  });

  test("requires trusted contexts before enabling credential operations", async () => {
    const write = vi.spyOn(browser.storage.local, "set");
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "api-key");

    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0]!,
    );
  });

  test("remains closed when trusted-context initialization fails", async () => {
    setAccessLevel.mockRejectedValueOnce(new Error("unavailable"));

    await expect(credentials.initializeCredentialStorage()).rejects.toThrow("unavailable");
    await credentials.saveProviderApiKey("elevenlabs", "api-key");

    expect(await credentials.readProviderCredential("elevenlabs")).toBeUndefined();
    expect(await localStorageContents()).toEqual({});
  });

  test("still deletes stored credentials after trusted-context initialization later fails", async () => {
    await credentials.initializeCredentialStorage();
    await credentials.saveProviderApiKey("elevenlabs", "synthetic-api-key");
    setAccessLevel.mockRejectedValueOnce(new Error("unavailable"));
    await expect(credentials.initializeCredentialStorage()).rejects.toThrow(
      "unavailable",
    );

    await credentials.deleteAllProviderCredentials();

    expect(await localStorageContents()).toEqual({});
  });
});
