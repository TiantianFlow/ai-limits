import { providerKinds, type ProviderKind } from "./provider-kind";

export interface ProviderPresentation {
  readonly markPath: string;
  readonly darkMarkPath?: string;
  readonly connectionLabel: string;
  readonly connectionDisclosure: string;
  readonly capabilities: readonly string[];
  readonly manualRefreshDisclosure?: string;
  readonly apiKeySetupUrl?: string;
}

const browserSessionDisclosure =
  "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.";

export const providerCatalog = {
  chatgpt: {
    displayName: "ChatGPT",
    presentation: {
      markPath: "/provider-marks/chatgpt.svg",
      connectionLabel: "Connect ChatGPT",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Message limits", "Credits"],
    },
  },
  claude: {
    displayName: "Claude",
    presentation: {
      markPath: "/provider-marks/claude.svg",
      connectionLabel: "Connect Claude",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Message limits", "Extra usage"],
    },
  },
  kimi: {
    displayName: "Kimi",
    presentation: {
      markPath: "/provider-marks/kimi.svg",
      darkMarkPath: "/provider-marks/kimi-dark.svg",
      connectionLabel: "Connect Kimi",
      connectionDisclosure:
        "With permission, AI Limits may read the exact value of Kimi's signed-in kimi-auth cookie or the page's localStorage.access_token on kimi.com. It stores normalized usage locally, not the credential.",
      capabilities: ["Subscription usage", "Coding limits"],
      manualRefreshDisclosure:
        "Connect and manual Refresh may briefly open one inactive Kimi tab when recovery is needed. Scheduled or automatic refresh never opens a tab.",
    },
  },
  cursor: {
    displayName: "Cursor",
    presentation: {
      markPath: "/provider-marks/cursor.svg",
      darkMarkPath: "/provider-marks/cursor-dark.svg",
      connectionLabel: "Connect Cursor",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Monthly usage", "On-demand spend"],
    },
  },
  elevenlabs: {
    displayName: "ElevenLabs",
    presentation: {
      markPath: "/provider-marks/elevenlabs.svg",
      connectionLabel: "Connect ElevenLabs",
      connectionDisclosure:
        "Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.",
      capabilities: ["Monthly credits", "Voice limits"],
      apiKeySetupUrl: "https://elevenlabs.io/app/developers/api-keys",
    },
  },
  newapi: {
    displayName: "New API",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      connectionLabel: "Connect New API",
      connectionDisclosure:
        "Uses one relay key and one New API instance URL you provide, stores both locally, and refreshes key-specific usage about every 15 minutes.",
      capabilities: ["API key quota", "Unlimited-key usage"],
    },
  },
} as const;

export const providerNames = Object.fromEntries(
  providerKinds.map((providerKind) => [
    providerKind,
    providerCatalog[providerKind].displayName,
  ]),
) as Record<ProviderKind, string>;

export function providerPresentation(
  providerKind: ProviderKind,
): ProviderPresentation {
  return providerCatalog[providerKind].presentation;
}
