/**
 * Extension stand-ins for a page served outside Chrome: English messages from
 * the locale file, plus no-op runtime and storage. Import this before any app
 * module.
 */
import { generateChromeMessages, parseMessagesText, type ParsedMessage } from "@wxt-dev/i18n/build";

import enSource from "../../../locales/en.yml?raw";

const parsed = parseMessagesText(enSource, "YAML");
const messages = generateChromeMessages(parsed);

function templateOf(message: ParsedMessage): string {
  if (message.type === "plural") return message.plurals.other ?? message.plurals.n ?? "";
  return message.message;
}

const templates = new Map(parsed.map((message) => [message.key.join("."), templateOf(message)]));
Object.assign(globalThis, {
  browser: {
    i18n: {
      getMessage(key: string, substitutions?: string | string[]): string {
        void substitutions;
        const dotted = key.replaceAll("_", ".");
        return templates.get(dotted) ?? messages[key]?.message ?? "";
      },
    },
    runtime: { getURL: (value: string) => value },
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
});
