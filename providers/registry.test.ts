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
    ]);
    expect(
      providerIds.map((providerId) => providerRegistry[providerId].id),
    ).toEqual(providerIds);
  });

  test("includes representative synthetic ElevenLabs Starter state", () => {
    const elevenlabs = createFixtureState(
      Date.parse("2030-04-15T12:00:00.000Z"),
    ).providers.find(({ providerId }) => providerId === "elevenlabs");

    expect(elevenlabs).toMatchObject({
      providerId: "elevenlabs",
      access: "granted",
      snapshot: {
        providerId: "elevenlabs",
        planLabel: "Starter",
        source: "fixture",
        windows: [
          { id: "monthly-credits", used: 2_500, limit: 10_000 },
          { id: "voice-slots", used: 2, limit: 10 },
          { id: "professional-voice-slots", used: 1, limit: 3 },
          { id: "voice-add-edits", used: 4, limit: 20 },
        ],
        credits: [],
      },
    });
    expect(JSON.stringify(elevenlabs)).not.toMatch(/xi-api-key|sk-[a-z0-9_-]+/i);
  });
});
