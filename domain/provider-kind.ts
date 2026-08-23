export const providerKinds = [
  "chatgpt",
  "claude",
  "kimi",
  "cursor",
  "grok",
  "elevenlabs",
  "newapi",
  "litellm",
  "clawrouter",
  "sub2api",
  "llmProxy",
  "deepseek",
  "moonshot",
  "deepinfra",
  "fireworks",
  "openai",
  "groqcloud",
  "openrouter",
] as const;

export type ProviderKind = (typeof providerKinds)[number];
export type BrowserSessionProviderKind =
  | "chatgpt"
  | "claude"
  | "kimi"
  | "cursor"
  | "grok";
export const apiKeyProviderKinds = [
  "elevenlabs",
  "newapi",
  "litellm",
  "clawrouter",
  "sub2api",
  "llmProxy",
  "deepseek",
  "moonshot",
  "deepinfra",
  "fireworks",
  "openai",
  "groqcloud",
  "openrouter",
] as const;
export type ApiKeyProviderKind = (typeof apiKeyProviderKinds)[number];

export function isProviderKind(value: unknown): value is ProviderKind {
  return (
    typeof value === "string" &&
    (providerKinds as readonly string[]).includes(value)
  );
}

export function isApiKeyProviderKind(
  value: unknown,
): value is ApiKeyProviderKind {
  return (
    typeof value === "string" &&
    (apiKeyProviderKinds as readonly string[]).includes(value)
  );
}
