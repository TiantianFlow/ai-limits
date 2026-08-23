import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ProviderInstanceConfig,
  ProviderInstanceRecord,
} from "../domain/model";
import { chatGptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import { providerDefinitions } from "./definitions";
import { elevenLabsAdapter } from "./elevenlabs/adapter";
import { grokAdapter } from "./grok/adapter";
import { createFixtureState } from "./fixtures";
import { kimiAdapter } from "./kimi/adapter";
import { clawRouterAdapter } from "./clawrouter/adapter";
import { liteLlmAdapter } from "./litellm/adapter";
import { llmProxyAdapter } from "./llm-proxy/adapter";
import { newApiAdapter } from "./newapi/adapter";
import { sub2apiAdapter } from "./sub2api/adapter";
import { providerKinds, providerRegistry } from "./registry";
import type {
  ProviderCollector,
  ProviderCredential,
  ProviderRuntimeServices,
} from "./types";

afterEach(() => vi.restoreAllMocks());

const fixed = { kind: "fixed" } as const;
const dynamic = {
  kind: "dynamic-origin",
  baseUrl: "https://relay.example/private/path?secret=no",
} as const;

function instance(
  providerKind: (typeof providerKinds)[number],
  config: ProviderInstanceConfig,
): ProviderInstanceRecord {
  return {
    id: `${providerKind}:default`,
    providerKind,
    config,
    access: "granted",
    createdAt: 1,
    history: [],
  };
}

const services: ProviderRuntimeServices = {
  fetch: vi.fn() as unknown as typeof fetch,
  now: 123,
  signal: new AbortController().signal,
  interaction: "forbidden",
};

const apiKey: ProviderCredential = { kind: "api-key", value: " secret " };

describe("provider registry", () => {
  test("scheduled Cursor collection performs only the base usage request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({
        billingCycleStart: "2030-04-01T00:00:00.000Z",
        billingCycleEnd: "2030-05-01T00:00:00.000Z",
        membershipType: "ultra",
        individualUsage: {
          plan: {
            enabled: true,
            autoPercentUsed: 17,
            apiPercentUsed: 25,
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      providerRegistry.cursor.collect(instance("cursor", fixed), {
        ...services,
        fetch,
        interaction: "forbidden",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://cursor.com/api/usage-summary",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("is exhaustive and owns exact cardinality, config, credentials, and permissions", () => {
    expect(providerKinds).toEqual([
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
      "grok",
      "elevenlabs",
      "newapi",
      "litellm",
      "clawrouter",
      "sub2api",
      "llmProxy",
    ]);
    expect(Object.keys(providerRegistry)).toEqual(providerKinds);

    expect(
      providerKinds.map((kind) => ({
        kind,
        cardinality: providerRegistry[kind].cardinality,
        credentialKind: providerRegistry[kind].credentialKind,
        configKind: providerRegistry[kind].configKind,
        accepted: providerRegistry[kind].normalizeConfig(
          providerRegistry[kind].configKind === "dynamic-origin" ? dynamic : fixed,
        ),
        rejected: providerRegistry[kind].normalizeConfig(
          providerRegistry[kind].configKind === "dynamic-origin" ? fixed : dynamic,
        ),
        permissions: providerRegistry[kind].requiredPermissions(
          providerRegistry[kind].configKind === "dynamic-origin" ? dynamic : fixed,
        ),
      })),
    ).toEqual([
      {
        kind: "chatgpt",
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        accepted: fixed,
        rejected: undefined,
        permissions: { origins: ["https://chatgpt.com/*"] },
      },
      {
        kind: "claude",
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        accepted: fixed,
        rejected: undefined,
        permissions: { origins: ["https://claude.ai/*"] },
      },
      {
        kind: "kimi",
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        accepted: fixed,
        rejected: undefined,
        permissions: {
          origins: ["https://www.kimi.com/*"],
          permissions: ["cookies", "scripting"],
        },
      },
      {
        kind: "cursor",
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        accepted: fixed,
        rejected: undefined,
        permissions: {
          origins: ["https://cursor.com/*"],
          permissions: ["scripting"],
        },
      },
      {
        kind: "grok",
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        accepted: fixed,
        rejected: undefined,
        permissions: { origins: ["https://grok.com/*"] },
      },
      {
        kind: "elevenlabs",
        cardinality: "single",
        credentialKind: "api-key",
        configKind: "fixed",
        accepted: fixed,
        rejected: undefined,
        permissions: { origins: ["https://api.elevenlabs.io/*"] },
      },
      {
        kind: "newapi",
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        accepted: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/private/path",
        },
        rejected: undefined,
        permissions: { origins: ["https://relay.example/*"] },
      },
      {
        kind: "litellm",
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        accepted: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/private/path",
        },
        rejected: undefined,
        permissions: { origins: ["https://relay.example/*"] },
      },
      {
        kind: "clawrouter",
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        accepted: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/private/path",
        },
        rejected: undefined,
        permissions: { origins: ["https://relay.example/*"] },
      },
      {
        kind: "sub2api",
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        accepted: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/private/path",
        },
        rejected: undefined,
        permissions: { origins: ["https://relay.example/*"] },
      },
      {
        kind: "llmProxy",
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        accepted: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/private/path",
        },
        rejected: undefined,
        permissions: { origins: ["https://relay.example/*"] },
      },
    ]);

    expect(providerRegistry.newapi.normalizeConfig({
      kind: "dynamic-origin",
      baseUrl: "javascript:alert(1)",
    })).toBeUndefined();
  });

  test("keeps manifest requirements exhaustive without making presentation metadata behavioral", () => {
    expect(Object.keys(providerDefinitions)).toEqual(providerKinds);
    expect(providerDefinitions).toEqual({
      chatgpt: {
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        optionalOrigins: ["https://chatgpt.com/*"],
        optionalPermissions: [],
      },
      claude: {
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        optionalOrigins: ["https://claude.ai/*"],
        optionalPermissions: [],
      },
      kimi: {
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        optionalOrigins: ["https://www.kimi.com/*"],
        optionalPermissions: ["cookies", "scripting"],
      },
      cursor: {
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        optionalOrigins: ["https://cursor.com/*"],
        optionalPermissions: ["scripting"],
      },
      grok: {
        cardinality: "single",
        credentialKind: "none",
        configKind: "fixed",
        optionalOrigins: ["https://grok.com/*"],
        optionalPermissions: [],
      },
      elevenlabs: {
        cardinality: "single",
        credentialKind: "api-key",
        configKind: "fixed",
        optionalOrigins: ["https://api.elevenlabs.io/*"],
        optionalPermissions: [],
      },
      newapi: {
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        optionalOrigins: [
          "https://*/*",
          "http://localhost/*",
          "http://127.0.0.1/*",
        ],
        optionalPermissions: [],
      },
      litellm: {
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        optionalOrigins: [
          "https://*/*",
          "http://localhost/*",
          "http://127.0.0.1/*",
        ],
        optionalPermissions: [],
      },
      clawrouter: {
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        optionalOrigins: [
          "https://*/*",
          "http://localhost/*",
          "http://127.0.0.1/*",
        ],
        optionalPermissions: [],
      },
      sub2api: {
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        optionalOrigins: [
          "https://*/*",
          "http://localhost/*",
          "http://127.0.0.1/*",
        ],
        optionalPermissions: [],
      },
      llmProxy: {
        cardinality: "multiple",
        credentialKind: "api-key",
        configKind: "dynamic-origin",
        optionalOrigins: [
          "https://*/*",
          "http://localhost/*",
          "http://127.0.0.1/*",
        ],
        optionalPermissions: [],
      },
    });
  });

  test("delegates collection through every package with normalized context", async () => {
    const adapters: Record<string, ProviderCollector> = {
      chatgpt: chatGptAdapter,
      claude: claudeAdapter,
      kimi: kimiAdapter,
      grok: grokAdapter,
      elevenlabs: elevenLabsAdapter,
      newapi: newApiAdapter,
      litellm: liteLlmAdapter,
      clawrouter: clawRouterAdapter,
      sub2api: sub2apiAdapter,
      llmProxy: llmProxyAdapter,
    };
    const adapterSpies = Object.fromEntries(
      Object.entries(adapters).map(([kind, adapter]) => [
        kind,
        vi.spyOn(adapter, "collect").mockResolvedValue({
          ok: false,
          health: { kind: "signed_out" },
        }),
      ]),
    );
    vi.spyOn(browser.cookies, "get").mockResolvedValue({
      value: "browser-token",
    } as never);

    for (const kind of providerKinds) {
      const config =
        providerRegistry[kind].configKind === "dynamic-origin" ? dynamic : fixed;
      const credential = providerRegistry[kind].credentialKind === "api-key"
        ? apiKey
        : undefined;
      await providerRegistry[kind].collect(
        instance(kind, config),
        services,
        credential,
      );
      if (kind !== "cursor") {
        expect(adapterSpies[kind]).toHaveBeenCalledTimes(1);
      }
    }

    expect(adapterSpies.chatgpt).toHaveBeenCalledWith({
      fetch: services.fetch,
      now: 123,
      signal: services.signal,
    });
    expect(adapterSpies.kimi).toHaveBeenCalledWith({
      fetch: services.fetch,
      now: 123,
      signal: services.signal,
      accessToken: "browser-token",
    });
    expect(adapterSpies.elevenlabs).toHaveBeenCalledWith({
      fetch: services.fetch,
      now: 123,
      signal: services.signal,
      credential: { kind: "api-key", value: "secret" },
    });
    expect(adapterSpies.newapi).toHaveBeenCalledWith({
      fetch: services.fetch,
      now: 123,
      signal: services.signal,
      credential: { kind: "api-key", value: "secret" },
      baseUrl: "https://relay.example/private/path",
    });
    expect(adapterSpies.litellm).toHaveBeenCalledWith({
      fetch: services.fetch,
      now: 123,
      signal: services.signal,
      credential: { kind: "api-key", value: "secret" },
      baseUrl: "https://relay.example/private/path",
    });
    expect(adapterSpies.llmProxy).toHaveBeenCalledWith({
      fetch: services.fetch,
      now: 123,
      signal: services.signal,
      credential: { kind: "api-key", value: "secret" },
      baseUrl: "https://relay.example/private/path",
    });
  });

  test("includes representative synthetic ElevenLabs Starter state", () => {
    const elevenlabs = createFixtureState(
      Date.parse("2030-04-15T12:00:00.000Z"),
    ).instances.find(({ providerKind }) => providerKind === "elevenlabs");

    expect(elevenlabs).toMatchObject({
      providerKind: "elevenlabs",
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
