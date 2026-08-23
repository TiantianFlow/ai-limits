import { providerKinds, type ProviderKind } from "./provider-kind";

export interface ProviderPresentation {
  readonly markPath: string;
  readonly darkMarkPath?: string;
  readonly apiKeySetupUrl?: string;
  readonly apiKeyGuide?: "elevenlabs" | "newapi";
}

export const providerCatalog = {
  chatgpt: {
    displayName: "ChatGPT",
    presentation: {
      markPath: "/provider-marks/chatgpt.svg",
    },
  },
  claude: {
    displayName: "Claude",
    presentation: {
      markPath: "/provider-marks/claude.svg",
    },
  },
  kimi: {
    displayName: "Kimi",
    presentation: {
      markPath: "/provider-marks/kimi.svg",
      darkMarkPath: "/provider-marks/kimi-dark.svg",
    },
  },
  cursor: {
    displayName: "Cursor",
    presentation: {
      markPath: "/provider-marks/cursor.svg",
      darkMarkPath: "/provider-marks/cursor-dark.svg",
    },
  },
  grok: {
    displayName: "Grok",
    presentation: {
      markPath: "/provider-marks/grok.svg",
      darkMarkPath: "/provider-marks/grok-dark.svg",
    },
  },
  mistral: {
    displayName: "Mistral",
    presentation: {
      markPath: "/provider-marks/mistral.svg",
    },
  },
  perplexity: {
    displayName: "Perplexity",
    presentation: {
      markPath: "/provider-marks/perplexity.svg",
    },
  },
  elevenlabs: {
    displayName: "ElevenLabs",
    presentation: {
      markPath: "/provider-marks/elevenlabs.svg",
      apiKeySetupUrl: "https://elevenlabs.io/app/developers/api-keys",
      apiKeyGuide: "elevenlabs",
    },
  },
  newapi: {
    displayName: "New API",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeyGuide: "newapi",
    },
  },
  litellm: {
    displayName: "LiteLLM",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
    },
  },
  clawrouter: {
    displayName: "ClawRouter",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
    },
  },
  sub2api: {
    displayName: "sub2api",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
    },
  },
  llmProxy: {
    displayName: "LLM Proxy",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
    },
  },
  deepseek: {
    displayName: "DeepSeek",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://platform.deepseek.com/api_keys",
    },
  },
  moonshot: {
    displayName: "Moonshot",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://platform.moonshot.ai/console/api-keys",
    },
  },
  deepinfra: {
    displayName: "DeepInfra",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://deepinfra.com/dash/api_keys",
    },
  },
  fireworks: {
    displayName: "Fireworks",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://app.fireworks.ai/settings/users/api-keys",
    },
  },
  openai: {
    displayName: "OpenAI",
    presentation: {
      markPath: "/provider-marks/openai.svg",
      apiKeySetupUrl: "https://platform.openai.com/api-keys",
    },
  },
  groqcloud: {
    displayName: "GroqCloud",
    presentation: {
      markPath: "/provider-marks/groqcloud.svg",
      apiKeySetupUrl: "https://console.groq.com/keys",
    },
  },
  openrouter: {
    displayName: "OpenRouter",
    presentation: {
      markPath: "/provider-marks/openrouter.svg",
      darkMarkPath: "/provider-marks/openrouter-dark.svg",
      apiKeySetupUrl: "https://openrouter.ai/settings/keys",
    },
  },
} as const;

export type ProviderBalanceCategory =
  | "balance-primary"
  | "pool-primary"
  | "none";

export const providerBalanceCategories = {
  chatgpt: "pool-primary",
  claude: "pool-primary",
  kimi: "none",
  cursor: "pool-primary",
  grok: "pool-primary",
  mistral: "balance-primary",
  perplexity: "pool-primary",
  elevenlabs: "pool-primary",
  newapi: "none",
  litellm: "none",
  clawrouter: "none",
  sub2api: "balance-primary",
  llmProxy: "none",
  deepseek: "balance-primary",
  moonshot: "balance-primary",
  deepinfra: "balance-primary",
  fireworks: "none",
  openai: "balance-primary",
  groqcloud: "none",
  openrouter: "balance-primary",
} as const satisfies Record<ProviderKind, ProviderBalanceCategory>;

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

export function shouldDisplayBalance(
  providerKind: ProviderKind,
  value: number,
): boolean {
  return value !== 0 || providerBalanceCategories[providerKind] === "balance-primary";
}
