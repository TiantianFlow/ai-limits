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
    ];
    const apiKeyKinds: ApiKeyProviderKind[] = ["elevenlabs", "newapi"];
    const allKinds: ProviderKind[] = [...browserSessionKinds, ...apiKeyKinds];

    expect(allKinds).toEqual(providerKinds);
  });

  test("provides complete local presentation metadata for every supported provider", () => {
    type Presentation = {
      markPath: string;
      darkMarkPath?: string;
      connectionLabel: string;
      connectionDisclosure: string;
      capabilities: readonly string[];
      manualRefreshDisclosure?: string;
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
        connectionLabel: "Connect ChatGPT",
        connectionDisclosure:
          "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
        capabilities: ["Message limits", "Credits"],
      },
      {
        providerId: "claude",
        markPath: "/provider-marks/claude.svg",
        connectionLabel: "Connect Claude",
        connectionDisclosure:
          "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
        capabilities: ["Message limits", "Extra usage"],
      },
      {
        providerId: "kimi",
        markPath: "/provider-marks/kimi.svg",
        darkMarkPath: "/provider-marks/kimi-dark.svg",
        connectionLabel: "Connect Kimi",
        connectionDisclosure:
          "With permission, AI Limits may read the exact value of Kimi's signed-in kimi-auth cookie or the page's localStorage.access_token on kimi.com. It stores normalized usage locally, not the credential.",
        capabilities: ["Subscription usage", "Coding limits"],
        manualRefreshDisclosure:
          "Connect and manual Refresh may briefly open one inactive Kimi tab when recovery is needed. Scheduled or automatic refresh never opens a tab.",
      },
      {
        providerId: "cursor",
        markPath: "/provider-marks/cursor.svg",
        darkMarkPath: "/provider-marks/cursor-dark.svg",
        connectionLabel: "Connect Cursor",
        connectionDisclosure:
          "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
        capabilities: ["Monthly usage", "On-demand spend"],
      },
      {
        providerId: "elevenlabs",
        markPath: "/provider-marks/elevenlabs.svg",
        connectionLabel: "Connect ElevenLabs",
        connectionDisclosure:
          "Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.",
        capabilities: ["Monthly credits", "Voice limits"],
        apiKeySetupUrl: "https://elevenlabs.io/app/developers/api-keys",
      },
      {
        providerId: "newapi",
        markPath: "/provider-marks/fallback.svg",
        connectionLabel: "Connect New API",
        connectionDisclosure:
          "Supports multiple independent connections. Each stores its own New API instance URL, relay key, label, usage, and History locally; same-origin connections share only Chrome's host permission.",
        capabilities: ["API key quota", "Unlimited-key usage"],
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
                providerKind === "newapi"
                  ? {
                      kind: "dynamic-origin",
                      baseUrl: "https://relay.example",
                    }
                  : { kind: "fixed" },
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
    expect(isApiKeyProviderKind("chatgpt")).toBe(false);
    expect(isApiKeyProviderKind("unknown")).toBe(false);
    expect(isApiKeyProviderKind(undefined)).toBe(false);
  });
});
