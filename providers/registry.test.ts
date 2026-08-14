import { describe, expect, test } from "vitest";

import { providerCatalog } from "./catalog";
import { createFixtureState } from "./fixtures";
import { providerRegistry, providerIds } from "./registry";

describe("provider registry", () => {
  test("contains every catalog provider with exact grants", () => {
    expect(providerIds).toEqual([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
      "elevenlabs",
      "newapi",
    ]);
    expect(
      providerIds.map((providerId) => [
        providerId,
        providerCatalog[providerId].optionalOrigins,
        providerCatalog[providerId].optionalPermissions,
      ]),
    ).toEqual([
      ["chatgpt", ["https://chatgpt.com/*"], []],
      ["claude", ["https://claude.ai/*"], []],
      ["kimi", ["https://www.kimi.com/*"], ["cookies", "scripting"]],
      ["cursor", ["https://cursor.com/*"], []],
      ["elevenlabs", ["https://api.elevenlabs.io/*"], []],
      [
        "newapi",
        ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
        [],
      ],
    ]);
    expect(
      providerIds.map((providerId) => providerRegistry[providerId].kind),
    ).toEqual(providerIds);
  });

  test("owns cardinality, configuration, credentials, and exact permissions", () => {
    expect(providerRegistry.newapi.cardinality).toBe("multiple");
    expect(providerRegistry.newapi.credentialKind).toBe("api-key");
    expect(providerRegistry.chatgpt.cardinality).toBe("single");
    expect(providerRegistry.chatgpt.credentialKind).toBe("none");
    expect(
      providerRegistry.newapi.normalizeConfig({
        kind: "dynamic-origin",
        baseUrl: "https://relay.example/path?secret=no",
      }),
    ).toEqual({ kind: "dynamic-origin", baseUrl: "https://relay.example" });
    expect(
      providerRegistry.newapi.requiredPermissions({
        kind: "dynamic-origin",
        baseUrl: "https://relay.example/private/path?secret=no",
      }),
    ).toEqual({ origins: ["https://relay.example/*"] });
    expect(
      providerRegistry.chatgpt.requiredPermissions({
        kind: "dynamic-origin",
        baseUrl: "https://wrong.example",
      }),
    ).toBeUndefined();
    expect(
      providerRegistry.kimi.requiredPermissions({ kind: "fixed" }),
    ).toEqual({
      origins: ["https://www.kimi.com/*"],
      permissions: ["cookies", "scripting"],
    });
  });

  test("includes representative synthetic ElevenLabs Starter state", () => {
    const elevenlabs = createFixtureState(
      Date.parse("2030-04-15T12:00:00.000Z"),
    ).providers.find(({ providerId }) => providerId === "elevenlabs");

    expect(elevenlabs).toMatchObject({
      providerId: "elevenlabs",
      access: "granted",
      snapshot: {
        providerKind: "elevenlabs",
        planLabel: "Starter",
        source: "fixture",
        metrics: [
          { type: "quota", id: "monthly-credits", used: 2_500, limit: 10_000 },
          { type: "quota", id: "voice-slots", used: 2, limit: 10 },
          { type: "quota", id: "professional-voice-slots", used: 1, limit: 3 },
          { type: "quota", id: "voice-add-edits", used: 4, limit: 20 },
        ],
      },
    });
    expect(JSON.stringify(elevenlabs)).not.toMatch(/xi-api-key|sk-[a-z0-9_-]+/i);
  });
});
