import { providerKinds, type ProviderKind } from "./provider-kind";

export interface ProviderPresentation {
  readonly markPath: string;
  readonly darkMarkPath?: string;
  readonly apiKeySetupUrl?: string;
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
      markPath: "/provider-marks/fallback.svg",
    },
  },
  perplexity: {
    displayName: "Perplexity",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
    },
  },
  elevenlabs: {
    displayName: "ElevenLabs",
    presentation: {
      markPath: "/provider-marks/elevenlabs.svg",
      apiKeySetupUrl: "https://elevenlabs.io/app/developers/api-keys",
    },
  },
  newapi: {
    displayName: "New API",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
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
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://platform.openai.com/usage",
    },
  },
  groqcloud: {
    displayName: "GroqCloud",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://console.groq.com/dashboard/usage",
    },
  },
  openrouter: {
    displayName: "OpenRouter",
    presentation: {
      markPath: "/provider-marks/fallback.svg",
      apiKeySetupUrl: "https://openrouter.ai/settings/credits",
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
