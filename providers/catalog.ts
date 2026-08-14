export interface ProviderPresentation {
  readonly markPath: string;
  readonly darkMarkPath?: string;
  readonly connectionLabel: string;
  readonly connectionDisclosure: string;
  readonly capabilities: readonly string[];
  readonly manualRefreshDisclosure?: string;
}

export type ProviderConnection =
  | { readonly kind: "browser-session" }
  | {
      readonly kind: "api-key";
      readonly origin: "static";
      readonly setupUrl: "https://elevenlabs.io/app/developers/api-keys";
    }
  | {
      readonly kind: "api-key";
      readonly origin: "dynamic";
    };

const browserSessionDisclosure =
  "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.";

export const providerCatalog = {
  chatgpt: {
    displayName: "ChatGPT",
    optionalOrigins: ["https://chatgpt.com/*"],
    optionalPermissions: [],
    connection: { kind: "browser-session" },
    scheduledRefresh: true,
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
    connection: { kind: "browser-session" },
    scheduledRefresh: true,
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
    connection: { kind: "browser-session" },
    scheduledRefresh: true,
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
    connection: { kind: "browser-session" },
    scheduledRefresh: true,
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
    optionalOrigins: ["https://api.elevenlabs.io/*"],
    optionalPermissions: [],
    connection: {
      kind: "api-key",
      origin: "static",
      setupUrl: "https://elevenlabs.io/app/developers/api-keys",
    },
    scheduledRefresh: true,
    presentation: {
      markPath: "/provider-marks/elevenlabs.svg",
      connectionLabel: "Connect ElevenLabs",
      connectionDisclosure:
        "Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.",
      capabilities: ["Monthly credits", "Voice limits"],
    },
  },
  newapi: {
    displayName: "New API",
    optionalOrigins: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    optionalPermissions: [],
    connection: { kind: "api-key", origin: "dynamic" },
    scheduledRefresh: true,
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      connectionLabel: "Connect New API",
      connectionDisclosure:
        "Uses one relay key and one New API instance URL you provide, stores both locally, and refreshes key-specific usage about every 15 minutes.",
      capabilities: ["API key quota", "Unlimited-key usage"],
    },
  },
} as const;

interface ProviderPermissionDefinition {
  readonly optionalOrigins: readonly string[];
  readonly connection?: ProviderConnection;
}

export function assertProviderCatalogPermissionSafety(
  catalog: Readonly<Record<string, ProviderPermissionDefinition>>,
): void {
  for (const [providerId, provider] of Object.entries(catalog)) {
    for (const origin of provider.optionalOrigins) {
      const dynamicNewApiOrigin =
        provider.connection?.kind === "api-key" &&
        provider.connection.origin === "dynamic" &&
        (origin === "https://*/*" ||
          origin === "http://localhost/*" ||
          origin === "http://127.0.0.1/*");
      if (dynamicNewApiOrigin) continue;

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

export type ProviderKind = keyof typeof providerCatalog;

/** @deprecated Temporary bridge removed in Task 7. */
export type ProviderId = ProviderKind;

export type BrowserSessionProviderKind = {
  [Kind in ProviderKind]: (typeof providerCatalog)[Kind]["connection"]["kind"] extends "browser-session"
    ? Kind
    : never;
}[ProviderKind];

export type ApiKeyProviderKind = Exclude<
  ProviderKind,
  BrowserSessionProviderKind
>;

/** @deprecated Temporary bridge removed in Task 7. */
export type ApiKeyProviderId = ApiKeyProviderKind;

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

export function isApiKeyProviderId(value: unknown): value is ApiKeyProviderId {
  return isProviderId(value) && providerCatalog[value].connection.kind === "api-key";
}
