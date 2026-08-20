import { describe, expect, it } from "vitest";

import {
  FIDELITY_FIXED_CLOCK,
  createFidelityScenario,
  parseFidelityRequest,
  parsePreviewLanguage,
  previewContent,
} from "./copy";

describe("store artwork copy", () => {
  it("parses an explicit fixture-only fixed-clock fidelity request", () => {
    const request = parseFidelityRequest(
      new URLSearchParams(
        `fidelity=1&screen=history&state=default&mode=left&theme=dark&panelWidth=340&dataSource=fixture&fixedClock=${encodeURIComponent(FIDELITY_FIXED_CLOCK)}&locale=en-US`,
      ),
    );

    expect(request).toEqual({
      screen: "history",
      state: "default",
      mode: "left",
      theme: "dark",
      panelWidth: 340,
      dataSource: "fixture",
      fixedClock: FIDELITY_FIXED_CLOCK,
      locale: "en-US",
      now: Date.parse(FIDELITY_FIXED_CLOCK),
    });
  });

  it.each(["unlabeled-collision", "rename-failure"] as const)(
    "accepts the deterministic %s fidelity state",
    (state) => {
      const request = parseFidelityRequest(
        new URLSearchParams(
          `fidelity=1&screen=settings&state=${state}&mode=used&theme=dark&panelWidth=340&dataSource=fixture&fixedClock=${encodeURIComponent(FIDELITY_FIXED_CLOCK)}&locale=en-US`,
        ),
      );

      expect(request?.state).toBe(state);
    },
  );

  it("keeps store artwork separate and rejects nondeterministic fidelity inputs", () => {
    expect(parseFidelityRequest(new URLSearchParams("view=overview"))).toBeNull();
    expect(() =>
      parseFidelityRequest(
        new URLSearchParams(
          "fidelity=1&screen=overview&state=default&mode=used&theme=light&panelWidth=400&dataSource=live&fixedClock=2026-08-09T14%3A00%3A00.000Z",
        ),
      ),
    ).toThrow(/fixture/i);
    expect(() =>
      parseFidelityRequest(
        new URLSearchParams(
          "fidelity=1&screen=overview&state=default&mode=used&theme=light&panelWidth=400&dataSource=fixture&locale=en-US",
        ),
      ),
    ).toThrow(/fixed clock/i);
    expect(() =>
      parseFidelityRequest(
        new URLSearchParams(
          "fidelity=1&screen=unknown&state=default&mode=used&theme=light&panelWidth=400&dataSource=fixture&fixedClock=2026-08-09T14%3A00%3A00.000Z&locale=en-US",
        ),
      ),
    ).toThrow(/screen/i);
    expect(() =>
      parseFidelityRequest(
        new URLSearchParams(
          "fidelity=1&screen=overview&state=default&mode=used&theme=light&panelWidth=400&dataSource=fixture&fixedClock=2026-08-09T14%3A00%3A00.000Z",
        ),
      ),
    ).toThrow(/locale/i);
  });

  it("maps fidelity screens and states to real Cockpit navigation steps", () => {
    const base = {
      screen: "overview" as const,
      state: "default" as const,
      mode: "used" as const,
      theme: "light" as const,
      panelWidth: 400 as const,
      dataSource: "fixture" as const,
      fixedClock: FIDELITY_FIXED_CLOCK,
      locale: "en-US" as const,
      now: Date.parse(FIDELITY_FIXED_CLOCK),
    };

    expect(createFidelityScenario({ ...base, screen: "first-run" })).toEqual(
      expect.objectContaining({
        fixtureVariant: "empty",
        readySelector: "[aria-labelledby=\"first-run-title\"]",
        navigationSteps: [],
      }),
    );
    expect(createFidelityScenario({ ...base, screen: "add-provider" })).toEqual(
      expect.objectContaining({
        fixtureVariant: "partial",
        navigationSteps: [
          {
            actionSelector: ".add-provider-action",
            readySelector: "[aria-label=\"Add provider\"]",
          },
        ],
      }),
    );
    expect(
      createFidelityScenario({ ...base, screen: "api-key-connect" }),
    ).toEqual(
      expect.objectContaining({
        fixtureVariant: "full",
        readySelector: '[aria-label="Replace ElevenLabs API key"]',
        navigationSteps: [
          {
            actionSelector: 'button[aria-label="Settings"]',
            readySelector: '[aria-label="Provider settings"]',
          },
          {
            actionSelector:
              'button[aria-label="Replace ElevenLabs API key"]',
            readySelector: '[aria-label="Replace ElevenLabs API key"]',
          },
        ],
      }),
    );
    expect(
      createFidelityScenario({
        ...base,
        screen: "provider-detail",
        state: "kimi-interaction",
      }),
    ).toEqual(
      expect.objectContaining({
        fixtureVariant: "full",
        providerOperation: "waiting_for_session",
        navigationSteps: [
          {
            actionSelector: "button[aria-label=\"Open Kimi details\"]",
            readySelector: "[aria-label=\"Kimi detail\"]",
          },
        ],
      }),
    );
    expect(
      createFidelityScenario({
        ...base,
        state: "partial-refresh",
      }),
    ).toEqual(
      expect.objectContaining({
        refreshAnnouncement: "3 providers updated. Kimi needs attention.",
      }),
    );
    expect(
      createFidelityScenario({
        ...base,
        screen: "settings",
        state: "delete-confirmation",
      }).navigationSteps,
    ).toEqual([
      {
        actionSelector: "button[aria-label=\"Settings\"]",
        readySelector: "[aria-label=\"Provider settings\"]",
      },
      {
        actionSelector: ".danger-zone__trigger",
        readySelector: "[aria-label=\"Confirm local data deletion\"]",
      },
    ]);
  });

  it("selects Simplified Chinese explicitly and defaults unknown locales to English", () => {
    expect(parsePreviewLanguage(new URLSearchParams("locale=zh_CN"))).toBe(
      "zh_CN",
    );
    expect(parsePreviewLanguage(new URLSearchParams("locale=fr"))).toBe("en");
    expect(parsePreviewLanguage(new URLSearchParams())).toBe("en");
  });

  it("keeps the Chinese media honest about the embedded English interface", () => {
    expect(previewContent.zh_CN.representativeLabel).toContain("英文");
    expect(previewContent.zh_CN.overview.title).toMatch(/[\u3400-\u9fff]/u);
    expect(previewContent.zh_CN.history.title).toMatch(/[\u3400-\u9fff]/u);
    expect(previewContent.zh_CN.history.description).toContain("每个实例");
    expect(previewContent.zh_CN.history.description).toContain("类型化历史");
  });

  it("gives local quota history a dedicated store-artwork view", () => {
    expect(previewContent.en.history.title).toMatch(/history/i);
    expect(previewContent.en.history.description).toMatch(/local/i);
    expect(previewContent.en.history.description).toMatch(/refresh/i);
    expect(previewContent.en.history.description).toContain(
      "Quota graphs use per-instance typed history",
    );
  });

  it("gives GitHub sharing a concise product and trust story", () => {
    expect(previewContent.en.social).toEqual({
      eyebrow: "Chrome side panel",
      title: "Usage limits, in one view.",
      description: "7 providers · Multiple New API instances",
    });
    expect(previewContent.en.socialNotes).toEqual([
      "Used or Left · Reset timing · Pace · Local history",
      "Local history. No remote backend.",
    ]);
    expect(previewContent.zh_CN.social.description).toBe(
      "7 个服务 · 多个 New API 实例",
    );
  });

  it("names all seven supported providers in the overview artwork", () => {
    expect(previewContent.en.providerLine).toBe(
      "ChatGPT · Claude · Kimi · Cursor · Grok · ElevenLabs · New API",
    );
    expect(previewContent.zh_CN.providerLine).toBe(
      "ChatGPT · Claude · Kimi · Cursor · Grok · ElevenLabs · New API",
    );
  });

  it("makes multi-instance New API support visible in both overview languages", () => {
    expect(previewContent.en.overview.description).toContain(
      "multiple independent New API instances",
    );
    expect(previewContent.zh_CN.overview.description).toContain(
      "多个相互独立的 New API 实例",
    );
  });

  it("keeps promotional descriptions concise at half-size", () => {
    expect(previewContent.en.promo.description.length).toBeLessThanOrEqual(60);
    expect([...previewContent.zh_CN.promo.description].length).toBeLessThanOrEqual(
      24,
    );
  });
});
