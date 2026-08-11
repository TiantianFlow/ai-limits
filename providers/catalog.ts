export const providerCatalog = {
  chatgpt: {
    displayName: "ChatGPT",
    optionalOrigins: ["https://chatgpt.com/*"],
    optionalPermissions: [],
  },
  claude: {
    displayName: "Claude",
    optionalOrigins: ["https://claude.ai/*"],
    optionalPermissions: [],
  },
  kimi: {
    displayName: "Kimi",
    optionalOrigins: ["https://www.kimi.com/*"],
    optionalPermissions: ["cookies", "scripting"],
  },
  cursor: {
    displayName: "Cursor",
    optionalOrigins: ["https://cursor.com/*"],
    optionalPermissions: [],
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

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(providerCatalog, value);
}
