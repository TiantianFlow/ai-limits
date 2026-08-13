import { chatGptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { ProviderId } from "./catalog";
import { cursorAdapter } from "./cursor/adapter";
import { elevenLabsAdapter } from "./elevenlabs/adapter";
import { kimiAdapter } from "./kimi/adapter";
import type { ProviderAdapter } from "./types";

export type ConnectableProviderId = ProviderId;

export { providerIds } from "./catalog";

export const providerRegistry = {
  chatgpt: chatGptAdapter,
  claude: claudeAdapter,
  kimi: kimiAdapter,
  cursor: cursorAdapter,
  elevenlabs: elevenLabsAdapter,
} satisfies { [Id in ProviderId]: ProviderAdapter<Id> };
