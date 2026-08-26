import type { ProviderKind } from "../domain/provider-kind";

export interface ProviderDefinition {
  readonly cardinality: "single" | "multiple";
  readonly credentialKind: "none" | "api-key";
  readonly configKind: "fixed" | "dynamic-origin";
  readonly optionalOrigins: readonly string[];
  readonly optionalPermissions: readonly Browser.runtime.ManifestPermission[];
}

export const providerDefinitions = {
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
    optionalPermissions: ["scripting"],
  },
  mistral: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: [
      "https://admin.mistral.ai/*",
      "https://console.mistral.ai/*",
    ],
    optionalPermissions: [],
  },
  perplexity: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://www.perplexity.ai/*"],
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
  deepseek: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.deepseek.com/*"],
    optionalPermissions: [],
  },
  moonshot: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.moonshot.ai/*"],
    optionalPermissions: [],
  },
  deepinfra: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.deepinfra.com/*"],
    optionalPermissions: [],
  },
  fireworks: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.fireworks.ai/*"],
    optionalPermissions: [],
  },
  openai: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.openai.com/*"],
    optionalPermissions: [],
  },
  groqcloud: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.groq.com/*"],
    optionalPermissions: [],
  },
  openrouter: {
    cardinality: "single",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://openrouter.ai/*"],
    optionalPermissions: [],
  },
} as const satisfies { [Kind in ProviderKind]: ProviderDefinition };
