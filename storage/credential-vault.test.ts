import { beforeEach, describe, expect, test, vi } from "vitest";

type CredentialVault = typeof import("./credential-vault");

let vault: CredentialVault;
let setAccessLevel: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await browser.storage.local.clear();
  setAccessLevel = vi.fn(async () => undefined);
  Object.assign(browser.storage.local, { setAccessLevel });
  vault = await import("./credential-vault");
});

describe("instance credential vault V2", () => {
  test("fails closed before trusted-context initialization", async () => {
    await expect(
      vault.saveApiKeyIfCurrent(
        "elevenlabs:default",
        "synthetic-key",
        () => true,
      ),
    ).resolves.toEqual({ saved: false });
    await expect(vault.readCredential("elevenlabs:default"))
      .resolves.toBeUndefined();
    await expect(browser.storage.local.get(null)).resolves.toEqual({});
  });

  test("enables operations only after trusted-context isolation succeeds", async () => {
    const write = vi.spyOn(browser.storage.local, "set");
    await vault.initializeCredentialVault();
    await vault.saveApiKeyIfCurrent(
      "elevenlabs:default",
      "synthetic-key",
      () => true,
    );

    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0]!,
    );
  });

  test("remains closed after trusted-context initialization fails", async () => {
    setAccessLevel.mockRejectedValueOnce(new Error("unavailable"));

    await expect(vault.initializeCredentialVault()).rejects.toThrow(
      "unavailable",
    );
    await expect(
      vault.saveApiKeyIfCurrent(
        "elevenlabs:default",
        "synthetic-key",
        () => true,
      ),
    ).resolves.toEqual({ saved: false });
    await expect(browser.storage.local.get(null)).resolves.toEqual({});
  });

  test("trims bounded keys and never stores a base URL in credentials", async () => {
    await vault.initializeCredentialVault();
    await vault.saveApiKeyIfCurrent(
      "newapi:550e8400-e29b-41d4-a716-446655440000",
      "  synthetic-relay-key  ",
      () => true,
    );

    await expect(
      vault.readCredential("newapi:550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toEqual({
      kind: "api-key",
      value: "synthetic-relay-key",
      status: "active",
    });
    expect(JSON.stringify(await browser.storage.local.get(null)))
      .not.toMatch(/baseUrl|relay\.example/);

    await expect(
      vault.saveApiKeyIfCurrent("newapi:default", "   ", () => true),
    ).resolves.toEqual({ saved: false });
    await expect(
      vault.saveApiKeyIfCurrent(
        "newapi:default",
        "x".repeat(4_097),
        () => true,
      ),
    ).resolves.toEqual({ saved: false });
  });

  test("rejects credentials for browser-session instance kinds", async () => {
    await vault.initializeCredentialVault();

    await expect(
      vault.saveApiKeyIfCurrent(
        "chatgpt:default",
        "synthetic-key",
        () => true,
      ),
    ).resolves.toEqual({ saved: false });
    await expect(vault.readCredential("chatgpt:default"))
      .resolves.toBeUndefined();
  });

  test("serializes concurrent saves so sibling instance credentials survive", async () => {
    await vault.initializeCredentialVault();

    await Promise.all([
      vault.saveApiKeyIfCurrent(
        "newapi:550e8400-e29b-41d4-a716-446655440000",
        "personal-key",
        () => true,
      ),
      vault.saveApiKeyIfCurrent(
        "newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f",
        "work-key",
        () => true,
      ),
    ]);

    await expect(
      vault.readCredential("newapi:550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toMatchObject({ value: "personal-key" });
    await expect(
      vault.readCredential("newapi:0c5f2af7-21d4-4cd1-bcd8-09005c65e45f"),
    ).resolves.toMatchObject({ value: "work-key" });
  });

  test("checks the current generation inside the serialized mutation", async () => {
    await vault.initializeCredentialVault();
    let current = false;

    await expect(
      vault.saveApiKeyIfCurrent(
        "elevenlabs:default",
        "superseded-key",
        () => current,
      ),
    ).resolves.toEqual({ saved: false });
    current = true;
    await expect(
      vault.saveApiKeyIfCurrent(
        "elevenlabs:default",
        "current-key",
        () => current,
      ),
    ).resolves.toMatchObject({ saved: true, previous: undefined });
  });

  test("uses revision CAS for rejection and rollback", async () => {
    await vault.initializeCredentialVault();
    const first = await vault.saveApiKeyIfCurrent(
      "elevenlabs:default",
      "first-key",
      () => true,
    );
    expect(first.saved).toBe(true);
    if (!first.saved) throw new Error("fixture save failed");

    const second = await vault.saveApiKeyIfCurrent(
      "elevenlabs:default",
      "second-key",
      () => true,
    );
    expect(second.saved).toBe(true);
    if (!second.saved) throw new Error("fixture save failed");

    await vault.markCredentialRejectedIfRevision(
      "elevenlabs:default",
      first.revision,
    );
    await expect(vault.readCredential("elevenlabs:default")).resolves.toMatchObject({
      value: "second-key",
      status: "active",
    });

    await vault.markCredentialRejectedIfRevision(
      "elevenlabs:default",
      second.revision,
    );
    await expect(vault.readCredential("elevenlabs:default")).resolves.toMatchObject({
      value: "second-key",
      status: "rejected",
    });

    await expect(
      vault.restoreCredentialIfRevision(
        "elevenlabs:default",
        first.revision,
        first.previous,
      ),
    ).resolves.toBe(false);
    await expect(
      vault.restoreCredentialIfRevision(
        "elevenlabs:default",
        second.revision,
        second.previous,
      ),
    ).resolves.toBe(false);
  });

  test("rolls an active candidate back only while its revision is current", async () => {
    await vault.initializeCredentialVault();
    await vault.saveApiKeyIfCurrent(
      "elevenlabs:default",
      "prior-key",
      () => true,
    );
    const candidate = await vault.saveApiKeyIfCurrent(
      "elevenlabs:default",
      "candidate-key",
      () => true,
    );
    if (!candidate.saved) throw new Error("fixture save failed");

    await expect(
      vault.restoreCredentialIfRevision(
        "elevenlabs:default",
        candidate.revision,
        candidate.previous,
      ),
    ).resolves.toBe(true);
    await expect(vault.readCredential("elevenlabs:default")).resolves.toMatchObject({
      value: "prior-key",
      status: "active",
    });
  });

  test("deletes one or all credentials without touching unrelated storage", async () => {
    await browser.storage.local.set({ unrelated: "keep" });
    await vault.initializeCredentialVault();
    await vault.saveApiKeyIfCurrent(
      "elevenlabs:default",
      "eleven-key",
      () => true,
    );
    await vault.saveApiKeyIfCurrent(
      "newapi:default",
      "relay-key",
      () => true,
    );

    await vault.deleteCredential("elevenlabs:default");
    await expect(vault.readCredential("elevenlabs:default"))
      .resolves.toBeUndefined();
    await expect(vault.readCredential("newapi:default"))
      .resolves.toMatchObject({ value: "relay-key" });

    await vault.deleteAllCredentials();
    await expect(vault.readCredential("newapi:default"))
      .resolves.toBeUndefined();
    await expect(browser.storage.local.get("unrelated")).resolves.toEqual({
      unrelated: "keep",
    });
  });

  test("fails closed on malformed V2 records and does not expose secret values in errors", async () => {
    await vault.initializeCredentialVault();
    await browser.storage.local.set({
      aiLimitsCredentials: {
        version: 2,
        credentials: {
          "newapi:default": {
            kind: "api-key",
            value: "stored-secret",
            status: "unknown",
            revision: "revision",
            baseUrl: "https://relay.example",
          },
        },
      },
    });

    await expect(vault.readCredential("newapi:default"))
      .resolves.toBeUndefined();
    const storageSet = vi.spyOn(browser.storage.local, "set")
      .mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      vault.saveApiKeyIfCurrent(
        "newapi:default",
        "candidate-secret",
        () => true,
      ),
    ).rejects.not.toThrow(/candidate-secret|relay\.example/);
    storageSet.mockRestore();
  });
});
