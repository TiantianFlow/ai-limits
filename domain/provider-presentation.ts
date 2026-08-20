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
      connectionDisclosure:
        "Reads base usage from your signed-in Cursor session and refreshes it about every 15 minutes. On Connect or manual Refresh, AI Limits may run bundled read-only code in one already-open cursor.com page to request Grok Bot and extra-credit JSON. It does not inspect page content, browser storage, or cookie values directly; Chrome attaches signed-in Cursor cookies to those fixed same-origin requests.",
      capabilities: [
        "Monthly usage",
        "Grok Bot usage",
        "On-demand spend",
        "Extra usage credits",
      ],
      manualRefreshDisclosure:
        "Cursor page enrichment uses only an already-open Cursor tab. It never creates or activates a tab, and scheduled or automatic refresh never injects into a page.",
    },
  },
  grok: {
    displayName: "Grok",
    presentation: {
      markPath: "/provider-marks/grok.svg",
      darkMarkPath: "/provider-marks/grok-dark.svg",
      connectionLabel: "Connect Grok",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Usage pool", "Plan tier"],
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
        "Supports multiple independent connections. Each stores its own New API instance URL, relay key, label, usage, and History locally; same-origin connections share only Chrome's host permission.",
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

const knownPlanLabels: Partial<
  Record<ProviderKind, Record<string, string>>
> = {
  chatgpt: {
    plus: "Plus",
  },
  cursor: {
    ultra: "Ultra",
  },
  elevenlabs: {
    free: "Free",
  },
};

export function providerPlanLabel(
  providerKind: ProviderKind,
  rawPlanLabel: string | undefined,
): string | undefined {
  if (rawPlanLabel === undefined) {
    return undefined;
  }

  return (
    knownPlanLabels[providerKind]?.[rawPlanLabel.toLowerCase()] ?? rawPlanLabel
  );
}

export function providerPresentation(
  providerKind: ProviderKind,
): ProviderPresentation {
  return providerCatalog[providerKind].presentation;
}
