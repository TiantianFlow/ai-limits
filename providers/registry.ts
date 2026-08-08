import type { ProviderId } from "../domain/model";
import { chatGptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import { cursorAdapter } from "./cursor/adapter";
import { kimiAdapter } from "./kimi/adapter";
import type { ProviderAdapter } from "./types";

export type ConnectableProviderId = ProviderId;

export const providerIds = ["chatgpt", "claude", "kimi", "cursor"] as const;

export const providerRegistry: Record<ConnectableProviderId, ProviderAdapter> = {
  chatgpt: chatGptAdapter,
  claude: claudeAdapter,
  kimi: kimiAdapter,
  cursor: cursorAdapter,
};
