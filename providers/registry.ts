import { chatGptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { ProviderId, ProviderKind } from "./catalog";
import { cursorAdapter } from "./cursor/adapter";
import { elevenLabsAdapter } from "./elevenlabs/adapter";
import { kimiAdapter } from "./kimi/adapter";
import { kimiPackage } from "./kimi/package";
import { newApiAdapter } from "./newapi/adapter";
import {
  createApiKeyPackage,
  createBrowserSessionPackage,
} from "./package-factories";
import type { ProviderAdapter, ProviderPackage } from "./types";

export type ConnectableProviderId = ProviderId;

export { providerIds } from "./catalog";

export const providerRegistry = {
  chatgpt: createBrowserSessionPackage({
    kind: "chatgpt",
    adapter: chatGptAdapter,
  }),
  claude: createBrowserSessionPackage({
    kind: "claude",
    adapter: claudeAdapter,
  }),
  kimi: kimiPackage,
  cursor: createBrowserSessionPackage({
    kind: "cursor",
    adapter: cursorAdapter,
  }),
  elevenlabs: createApiKeyPackage({
    kind: "elevenlabs",
    adapter: elevenLabsAdapter,
  }),
  newapi: createApiKeyPackage({
    kind: "newapi",
    adapter: newApiAdapter,
  }),
} satisfies { [Kind in ProviderKind]: ProviderPackage };

/**
 * Task 4 compatibility only: V4 commit and connection helpers still consume
 * endpoint adapters. Task 5 replaces those consumers with ProviderPackage.
 */
export const legacyProviderAdapterRegistry = {
  chatgpt: chatGptAdapter,
  claude: claudeAdapter,
  kimi: kimiAdapter,
  cursor: cursorAdapter,
  elevenlabs: elevenLabsAdapter,
  newapi: newApiAdapter,
} satisfies { [Id in ProviderId]: ProviderAdapter<Id> };
