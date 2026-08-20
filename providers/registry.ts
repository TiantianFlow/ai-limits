import { chatGptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { ProviderKind } from "./catalog";
import { cursorPackage } from "./cursor/package";
import { elevenLabsAdapter } from "./elevenlabs/adapter";
import { grokAdapter } from "./grok/adapter";
import { kimiPackage } from "./kimi/package";
import { newApiAdapter } from "./newapi/adapter";
import {
  createApiKeyPackage,
  createBrowserSessionPackage,
  normalizeFixedConfig,
} from "./package-factories";
import {
  newApiPermissionOrigin,
  normalizeNewApiBaseUrl,
} from "./newapi/url";
import { providerDefinitions } from "./definitions";
import type { ProviderPackage } from "./types";

export { providerKinds } from "./catalog";

function fixedPermissions(
  origins: readonly string[],
  permissions: readonly Browser.runtime.ManifestPermission[] = [],
) {
  return (config: unknown): Browser.permissions.Permissions | undefined =>
    normalizeFixedConfig(config)
      ? {
          ...(origins.length ? { origins: [...origins] } : {}),
          ...(permissions.length ? { permissions: [...permissions] } : {}),
        }
      : undefined;
}

function normalizeDynamicOrigin(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { kind?: unknown }).kind !== "dynamic-origin"
  ) {
    return undefined;
  }
  const baseUrl = normalizeNewApiBaseUrl(
    (value as { baseUrl?: unknown }).baseUrl,
  );
  return baseUrl ? ({ kind: "dynamic-origin", baseUrl } as const) : undefined;
}

export const providerRegistry = {
  chatgpt: createBrowserSessionPackage({
    kind: "chatgpt",
    adapter: chatGptAdapter,
    cardinality: providerDefinitions.chatgpt.cardinality,
    requiredPermissions: fixedPermissions(
      providerDefinitions.chatgpt.optionalOrigins,
      providerDefinitions.chatgpt.optionalPermissions,
    ),
  }),
  claude: createBrowserSessionPackage({
    kind: "claude",
    adapter: claudeAdapter,
    cardinality: providerDefinitions.claude.cardinality,
    requiredPermissions: fixedPermissions(
      providerDefinitions.claude.optionalOrigins,
      providerDefinitions.claude.optionalPermissions,
    ),
  }),
  kimi: kimiPackage,
  cursor: cursorPackage,
  grok: createBrowserSessionPackage({
    kind: "grok",
    adapter: grokAdapter,
    cardinality: providerDefinitions.grok.cardinality,
    requiredPermissions: fixedPermissions(
      providerDefinitions.grok.optionalOrigins,
      providerDefinitions.grok.optionalPermissions,
    ),
  }),
  elevenlabs: createApiKeyPackage({
    kind: "elevenlabs",
    adapter: elevenLabsAdapter,
    cardinality: providerDefinitions.elevenlabs.cardinality,
    configKind: providerDefinitions.elevenlabs.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.elevenlabs.optionalOrigins,
      providerDefinitions.elevenlabs.optionalPermissions,
    ),
  }),
  newapi: createApiKeyPackage({
    kind: "newapi",
    adapter: newApiAdapter,
    cardinality: providerDefinitions.newapi.cardinality,
    configKind: providerDefinitions.newapi.configKind,
    normalizeConfig: normalizeDynamicOrigin,
    requiredPermissions: (config) => {
      const normalized = normalizeDynamicOrigin(config);
      const origin =
        normalized === undefined
          ? undefined
          : newApiPermissionOrigin(normalized.baseUrl);
      return origin ? { origins: [origin] } : undefined;
    },
  }),
} satisfies { [Kind in ProviderKind]: ProviderPackage };
