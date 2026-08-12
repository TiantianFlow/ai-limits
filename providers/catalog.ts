export interface ProviderPresentation {
  readonly markPath: string;
  readonly darkMarkPath?: string;
  readonly connectionLabel: string;
  readonly connectionDisclosure: string;
  readonly capabilities: readonly string[];
  readonly manualRefreshDisclosure?: string;
}

const browserSessionDisclosure =
  "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.";

export const providerCatalog = {
  chatgpt: {
    displayName: "ChatGPT",
    optionalOrigins: ["https://chatgpt.com/*"],
    optionalPermissions: [],
    presentation: {
      markPath: "/provider-marks/chatgpt.svg",
      connectionLabel: "Connect ChatGPT",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Message limits", "Credits"],
    },
  },
  claude: {
    displayName: "Claude",
    optionalOrigins: ["https://claude.ai/*"],
    optionalPermissions: [],
    presentation: {
      markPath: "/provider-marks/claude.svg",
      connectionLabel: "Connect Claude",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Message limits", "Extra usage"],
    },
  },
  kimi: {
    displayName: "Kimi",
    optionalOrigins: ["https://www.kimi.com/*"],
    optionalPermissions: ["cookies", "scripting"],
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
    optionalOrigins: ["https://cursor.com/*"],
    optionalPermissions: [],
    presentation: {
      markPath: "/provider-marks/cursor.svg",
      darkMarkPath: "/provider-marks/cursor-dark.svg",
      connectionLabel: "Connect Cursor",
      connectionDisclosure: browserSessionDisclosure,
      capabilities: ["Monthly usage", "On-demand spend"],
    },
  },
} as const;

interface ProviderPermissionDefinition {
  readonly optionalOrigins: readonly string[];
}

export function assertProviderCatalogPermissionSafety(
  catalog: Readonly<Record<string, ProviderPermissionDefinition>>,
): void {
  for (const [providerId, provider] of Object.entries(catalog)) {
    for (const origin of provider.optionalOrigins) {
      let parsedOrigin: URL | undefined;
      try {
        parsedOrigin = new URL(origin.endsWith("/*") ? origin.slice(0, -2) : "");
      } catch {
        // The common error below explains the supported catalog contract.
      }

      if (
        parsedOrigin?.protocol !== "https:" ||
        parsedOrigin.hostname.includes("*") ||
        parsedOrigin.port !== "" ||
        origin !== `${parsedOrigin.origin}/*`
      ) {
        throw new Error(
          `${providerId} optional origin must grant one exact HTTPS host: ${origin}`,
        );
      }
    }
  }
}

assertProviderCatalogPermissionSafety(providerCatalog);

export type ProviderId = keyof typeof providerCatalog;

export const providerIds = Object.keys(providerCatalog) as ProviderId[];

export const providerNames = Object.fromEntries(
  providerIds.map((providerId) => [
    providerId,
    providerCatalog[providerId].displayName,
  ]),
) as Record<ProviderId, string>;

export function providerPresentation(providerId: ProviderId): ProviderPresentation {
  return providerCatalog[providerId].presentation;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(providerCatalog, value);
}
