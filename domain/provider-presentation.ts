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
