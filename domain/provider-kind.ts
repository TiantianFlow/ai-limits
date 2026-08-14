export const providerKinds = [
  "chatgpt",
  "claude",
  "kimi",
  "cursor",
  "elevenlabs",
  "newapi",
] as const;

export type ProviderKind = (typeof providerKinds)[number];
export type BrowserSessionProviderKind =
  | "chatgpt"
  | "claude"
  | "kimi"
  | "cursor";
export type ApiKeyProviderKind = "elevenlabs" | "newapi";

export function isProviderKind(value: unknown): value is ProviderKind {
  return (
    typeof value === "string" &&
    (providerKinds as readonly string[]).includes(value)
  );
}

export function isApiKeyProviderKind(
  value: unknown,
): value is ApiKeyProviderKind {
  return value === "elevenlabs" || value === "newapi";
}
