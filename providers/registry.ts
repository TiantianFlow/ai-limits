import { chatGptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { ProviderKind } from "./catalog";
import { cursorPackage } from "./cursor/package";
import { deepInfraAdapter } from "./deepinfra/adapter";
import { deepSeekAdapter } from "./deepseek/adapter";
import { elevenLabsAdapter } from "./elevenlabs/adapter";
import { fireworksAdapter } from "./fireworks/adapter";
import { grokAdapter } from "./grok/adapter";
import { groqCloudAdapter } from "./groqcloud/adapter";
import { openAiAdapter } from "./openai/adapter";
import { openRouterAdapter } from "./openrouter/adapter";
import { kimiPackage } from "./kimi/package";
import { clawRouterAdapter } from "./clawrouter/adapter";
import { liteLlmAdapter } from "./litellm/adapter";
import { llmProxyAdapter } from "./llm-proxy/adapter";
import { moonshotAdapter } from "./moonshot/adapter";
import { mistralAdapter } from "./mistral/adapter";
import { newApiAdapter } from "./newapi/adapter";
import { perplexityAdapter } from "./perplexity/adapter";
import { sub2apiAdapter } from "./sub2api/adapter";
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
import type { ProviderCollector, ProviderPackage } from "./types";
import type { ApiKeyProviderKind } from "./catalog";

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

function dynamicOriginPermissions(config: unknown) {
  const normalized = normalizeDynamicOrigin(config);
  const origin =
    normalized === undefined
      ? undefined
      : newApiPermissionOrigin(normalized.baseUrl);
  return origin ? { origins: [origin] } : undefined;
}

function dynamicOriginApiKeyPackage<Kind extends ApiKeyProviderKind>(
  kind: Kind,
  adapter: ProviderCollector<Kind>,
) {
  return createApiKeyPackage({
    kind,
    adapter,
    cardinality: providerDefinitions[kind].cardinality,
    configKind: providerDefinitions[kind].configKind,
    normalizeConfig: normalizeDynamicOrigin,
    requiredPermissions: dynamicOriginPermissions,
  });
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
  mistral: createBrowserSessionPackage({
    kind: "mistral",
    adapter: mistralAdapter,
    cardinality: providerDefinitions.mistral.cardinality,
    requiredPermissions: fixedPermissions(
      providerDefinitions.mistral.optionalOrigins,
      providerDefinitions.mistral.optionalPermissions,
    ),
  }),
  perplexity: createBrowserSessionPackage({
    kind: "perplexity",
    adapter: perplexityAdapter,
    cardinality: providerDefinitions.perplexity.cardinality,
    requiredPermissions: fixedPermissions(
      providerDefinitions.perplexity.optionalOrigins,
      providerDefinitions.perplexity.optionalPermissions,
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
  newapi: dynamicOriginApiKeyPackage("newapi", newApiAdapter),
  litellm: dynamicOriginApiKeyPackage("litellm", liteLlmAdapter),
  clawrouter: dynamicOriginApiKeyPackage("clawrouter", clawRouterAdapter),
  sub2api: dynamicOriginApiKeyPackage("sub2api", sub2apiAdapter),
  llmProxy: dynamicOriginApiKeyPackage("llmProxy", llmProxyAdapter),
  deepseek: createApiKeyPackage({
    kind: "deepseek",
    adapter: deepSeekAdapter,
    cardinality: providerDefinitions.deepseek.cardinality,
    configKind: providerDefinitions.deepseek.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.deepseek.optionalOrigins,
      providerDefinitions.deepseek.optionalPermissions,
    ),
  }),
  moonshot: createApiKeyPackage({
    kind: "moonshot",
    adapter: moonshotAdapter,
    cardinality: providerDefinitions.moonshot.cardinality,
    configKind: providerDefinitions.moonshot.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.moonshot.optionalOrigins,
      providerDefinitions.moonshot.optionalPermissions,
    ),
  }),
  deepinfra: createApiKeyPackage({
    kind: "deepinfra",
    adapter: deepInfraAdapter,
    cardinality: providerDefinitions.deepinfra.cardinality,
    configKind: providerDefinitions.deepinfra.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.deepinfra.optionalOrigins,
      providerDefinitions.deepinfra.optionalPermissions,
    ),
  }),
  fireworks: createApiKeyPackage({
    kind: "fireworks",
    adapter: fireworksAdapter,
    cardinality: providerDefinitions.fireworks.cardinality,
    configKind: providerDefinitions.fireworks.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.fireworks.optionalOrigins,
      providerDefinitions.fireworks.optionalPermissions,
    ),
  }),
  openai: createApiKeyPackage({
    kind: "openai",
    adapter: openAiAdapter,
    cardinality: providerDefinitions.openai.cardinality,
    configKind: providerDefinitions.openai.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.openai.optionalOrigins,
      providerDefinitions.openai.optionalPermissions,
    ),
  }),
  groqcloud: createApiKeyPackage({
    kind: "groqcloud",
    adapter: groqCloudAdapter,
    cardinality: providerDefinitions.groqcloud.cardinality,
    configKind: providerDefinitions.groqcloud.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.groqcloud.optionalOrigins,
      providerDefinitions.groqcloud.optionalPermissions,
    ),
  }),
  openrouter: createApiKeyPackage({
    kind: "openrouter",
    adapter: openRouterAdapter,
    cardinality: providerDefinitions.openrouter.cardinality,
    configKind: providerDefinitions.openrouter.configKind,
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: fixedPermissions(
      providerDefinitions.openrouter.optionalOrigins,
      providerDefinitions.openrouter.optionalPermissions,
    ),
  }),
} satisfies { [Kind in ProviderKind]: ProviderPackage };
