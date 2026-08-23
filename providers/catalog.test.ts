import { describe, expect, test } from "vitest";

import { isRuntimeCommand } from "../background/messages";
import * as catalog from "./catalog";
import {
  isApiKeyProviderKind,
  isProviderKind,
  providerKinds,
} from "./catalog";
import type {
  ApiKeyProviderKind,
  BrowserSessionProviderKind,
  ProviderKind,
} from "./catalog";
import { providerRegistry } from "./registry";

describe("provider catalog", () => {
  test("derives provider kind vocabularies from the static catalog", () => {
    const browserSessionKinds: BrowserSessionProviderKind[] = [
      "chatgpt",
      "claude",
      "kimi",
      "cursor",
      "grok",
    ];
    const apiKeyKinds: ApiKeyProviderKind[] = [
      "elevenlabs",
      "newapi",
      "litellm",
      "clawrouter",
      "sub2api",
      "llmProxy",
      "deepseek",
      "moonshot",
      "deepinfra",
      "fireworks",
      "openai",
      "groqcloud",
      "openrouter",
    ];
    const allKinds: ProviderKind[] = [...browserSessionKinds, ...apiKeyKinds];

    expect(allKinds).toEqual(providerKinds);
  });

  test("provides locale-neutral mark and setup metadata for every supported provider", () => {
    type Presentation = {
      markPath: string;
      darkMarkPath?: string;
      apiKeySetupUrl?: string;
    };
    const providerPresentation = (
      catalog as typeof catalog & {
        providerPresentation?: (providerId: (typeof providerKinds)[number]) => Presentation;
      }
    ).providerPresentation;

    expect(providerPresentation).toBeTypeOf("function");
    if (!providerPresentation) return;

    expect(
      providerKinds.map((providerId) => ({
        providerId,
        ...providerPresentation(providerId),
      })),
    ).toEqual([
      {
        providerId: "chatgpt",
        markPath: "/provider-marks/chatgpt.svg",
      },
      {
        providerId: "claude",
        markPath: "/provider-marks/claude.svg",
      },
      {
        providerId: "kimi",
        markPath: "/provider-marks/kimi.svg",
        darkMarkPath: "/provider-marks/kimi-dark.svg",
      },
      {
        providerId: "cursor",
        markPath: "/provider-marks/cursor.svg",
        darkMarkPath: "/provider-marks/cursor-dark.svg",
      },
      {
        providerId: "grok",
        markPath: "/provider-marks/grok.svg",
        darkMarkPath: "/provider-marks/grok-dark.svg",
      },
      {
        providerId: "elevenlabs",
        markPath: "/provider-marks/elevenlabs.svg",
        apiKeySetupUrl: "https://elevenlabs.io/app/developers/api-keys",
      },
      {
        providerId: "newapi",
        markPath: "/provider-marks/fallback.svg",
      },
      {
        providerId: "litellm",
        markPath: "/provider-marks/fallback.svg",
      },
      {
        providerId: "clawrouter",
        markPath: "/provider-marks/fallback.svg",
      },
      {
        providerId: "sub2api",
        markPath: "/provider-marks/fallback.svg",
      },
      {
        providerId: "llmProxy",
        markPath: "/provider-marks/fallback.svg",
      },
      {
        providerId: "deepseek",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://platform.deepseek.com/api_keys",
      },
      {
        providerId: "moonshot",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://platform.moonshot.ai/console/api-keys",
      },
      {
        providerId: "deepinfra",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://deepinfra.com/dash/api_keys",
      },
      {
        providerId: "fireworks",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://app.fireworks.ai/settings/users/api-keys",
      },
      {
        providerId: "openai",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://platform.openai.com/usage",
      },
      {
        providerId: "groqcloud",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://console.groq.com/dashboard/usage",
      },
      {
        providerId: "openrouter",
        markPath: "/provider-marks/fallback.svg",
        apiKeySetupUrl: "https://openrouter.ai/settings/credits",
      },
    ]);
  });

  test("keeps registry and runtime commands catalog-complete", () => {
    expect(Object.keys(providerRegistry)).toEqual(providerKinds);
    expect(
      providerKinds.map((providerId) => providerRegistry[providerId].kind),
    ).toEqual(providerKinds);
    expect(
      providerKinds.every((providerKind) =>
        isApiKeyProviderKind(providerKind)
          ? isRuntimeCommand({
              type: "CONNECT_API_KEY_PROVIDER",
              providerKind,
              config:
                providerRegistry[providerKind].configKind === "fixed"
                  ? { kind: "fixed" }
                  : {
                      kind: "dynamic-origin",
                      baseUrl: "https://relay.example",
                    },
              apiKey: "candidate",
              permissionIntentId: "550e8400-e29b-41d4-a716-446655440099",
            })
          : isRuntimeCommand({
              type: "CONNECT_BROWSER_PROVIDER",
              providerKind,
              permissionIntentId: "550e8400-e29b-41d4-a716-446655440099",
            }),
      ),
    ).toBe(true);
  });

  test("rejects unknown and non-string provider identifiers", () => {
    expect(isProviderKind("chatgpt")).toBe(true);
    expect(isProviderKind("antigravity")).toBe(false);
    expect(isProviderKind(undefined)).toBe(false);
    expect(isProviderKind({ providerId: "chatgpt" })).toBe(false);
  });

  test("derives API-key provider identities from the catalog", () => {
    expect(isApiKeyProviderKind("elevenlabs")).toBe(true);
    expect(isApiKeyProviderKind("newapi")).toBe(true);
    expect(isApiKeyProviderKind("litellm")).toBe(true);
    expect(isApiKeyProviderKind("llmProxy")).toBe(true);
    expect(isApiKeyProviderKind("deepseek")).toBe(true);
    expect(isApiKeyProviderKind("moonshot")).toBe(true);
    expect(isApiKeyProviderKind("deepinfra")).toBe(true);
    expect(isApiKeyProviderKind("fireworks")).toBe(true);
    expect(isApiKeyProviderKind("openai")).toBe(true);
    expect(isApiKeyProviderKind("groqcloud")).toBe(true);
    expect(isApiKeyProviderKind("openrouter")).toBe(true);
    expect(isApiKeyProviderKind("chatgpt")).toBe(false);
    expect(isApiKeyProviderKind("unknown")).toBe(false);
    expect(isApiKeyProviderKind(undefined)).toBe(false);
  });
});
