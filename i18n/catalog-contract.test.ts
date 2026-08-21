import {
  generateChromeMessages,
  parseMessagesText,
  SUPPORTED_LOCALES,
  type ParsedMessage,
} from "@wxt-dev/i18n/build";
import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES as APP_LOCALES } from "./locales";

const localeSources = import.meta.glob("../locales/*.{yml,yaml}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const tsxSources = import.meta.glob("../entrypoints/sidepanel/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DEFAULT_LOCALE = "en";
const PLURAL_LEAVES = ["zero", "one", "two", "few", "many", "other"] as const;
const MANIFEST_KEYS = [
  "manifest.name",
  "manifest.description",
  "manifest.actionTitle",
];
const ALLOWED_JSX_TEXT = new Set([
  "+",
  "×",
  "▾",
  "·",
  "—",
  "User → Read",
  "/v1/messages",
  "/api/status",
  "/api/usage/token/",
]);
const ALLOWED_LITERAL_RE =
  /^(used|left|general|model|feature|product|elapsed|remaining|default|USD|chatgpt|claude|kimi|cursor|grok|elevenlabs|newapi)$/;

function chromeKey(message: ParsedMessage): string {
  return message.key.join("_");
}

function dottedKey(message: ParsedMessage): string {
  return message.key.join(".");
}

function namedPlaceholders(message: ParsedMessage): string[] {
  return [...message.namedSubstitutions].sort();
}

function isPluralFamily(keys: string[]): boolean {
  return (
    keys.length === PLURAL_LEAVES.length &&
    PLURAL_LEAVES.every((leaf) => keys.includes(leaf))
  );
}

function parentKey(message: ParsedMessage): string {
  return message.key.slice(0, -1).join(".");
}

function localeFromPath(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.(yml|yaml)$/u, "");
}

function uncatalogedJsxLiterals(source: string): string[] {
  const literals: string[] = [];
  const jsxText = source.matchAll(/>([^<>{}\n]+)</g);
  for (const match of jsxText) {
    const text = match[1]?.trim() ?? "";
    if (
      !text ||
      ALLOWED_JSX_TEXT.has(text) ||
      !/[A-Za-z]/.test(text) ||
      text === "Promise" ||
      /^[a-z0-9-]+$/.test(text)
    ) {
      continue;
    }
    if (text.startsWith("{") || ALLOWED_LITERAL_RE.test(text)) {
      continue;
    }
    literals.push(text);
  }
  const attributes = source.matchAll(
    /\b(?:aria-label|title|placeholder|alt)=["']([^"'{]+)["']/g,
  );
  for (const match of attributes) {
    const text = match[1]?.trim() ?? "";
    if (
      !text ||
      ALLOWED_JSX_TEXT.has(text) ||
      ALLOWED_LITERAL_RE.test(text) ||
      text.startsWith("connect-") ||
      text.startsWith("overview-") ||
      text.startsWith("provider-") ||
      text.startsWith("settings-")
    ) {
      continue;
    }
    literals.push(text);
  }
  return literals;
}

describe("i18n catalog contract", () => {
  it("keeps locale files structurally aligned with English", () => {
    const files = Object.keys(localeSources);
    expect(files.some((path) => localeFromPath(path) === DEFAULT_LOCALE)).toBe(
      true,
    );

    const catalogs = new Map<string, ParsedMessage[]>();
    for (const [path, source] of Object.entries(localeSources)) {
      const locale = localeFromPath(path);
      expect(
        SUPPORTED_LOCALES.has(locale),
        `${locale} is not a Chrome-supported locale`,
      ).toBe(true);
      catalogs.set(locale, parseMessagesText(source, "YAML"));
    }

    const locales = [...catalogs.keys()].sort();
    expect(new Set(locales).size).toBe(locales.length);

    const english = catalogs.get(DEFAULT_LOCALE)!;
    const englishKeys = new Set(english.map(dottedKey));
    const englishByKey = new Map(
      english.map((message) => [dottedKey(message), message]),
    );

    const chromeKeys = english.map(chromeKey);
    expect(new Set(chromeKeys).size).toBe(chromeKeys.length);

    const pluralFamilies = new Map<string, string[]>();
    for (const message of english) {
      const leaf = message.key.at(-1);
      if (leaf && (PLURAL_LEAVES as readonly string[]).includes(leaf)) {
        const parent = parentKey(message);
        pluralFamilies.set(parent, [...(pluralFamilies.get(parent) ?? []), leaf]);
      }
    }
    for (const [family, leaves] of pluralFamilies) {
      expect(isPluralFamily(leaves), `${family} is missing a CLDR plural leaf`).toBe(
        true,
      );
      const placeholderSets = PLURAL_LEAVES.map((leaf) =>
        namedPlaceholders(englishByKey.get(`${family}.${leaf}`)!).join(","),
      );
      expect(new Set(placeholderSets).size).toBe(1);
    }

    for (const key of MANIFEST_KEYS) {
      const message = englishByKey.get(key);
      expect(message, `missing manifest key ${key}`).toBeDefined();
      expect(message?.namedSubstitutions ?? []).toEqual([]);
      expect(message?.substitutions ?? 0).toBe(0);
    }

    for (const [locale, messages] of catalogs) {
      const keys = new Set(messages.map(dottedKey));
      expect([...englishKeys].sort(), `${locale} keys`).toEqual(
        [...keys].sort(),
      );
      for (const message of messages) {
        const counterpart = englishByKey.get(dottedKey(message))!;
        expect(namedPlaceholders(message), dottedKey(message)).toEqual(
          namedPlaceholders(counterpart),
        );
      }

      const metaTag = messages.find(
        (message) => dottedKey(message) === "meta.localeTag",
      );
      const metaDirection = messages.find(
        (message) => dottedKey(message) === "meta.direction",
      );
      const metaDisplayName = messages.find(
        (message) => dottedKey(message) === "meta.displayName",
      );
      expect(metaTag?.type).toBe("simple");
      expect(metaDirection?.type).toBe("simple");
      expect(metaDisplayName?.type).toBe("simple");
      if (metaDisplayName?.type === "simple") {
        expect(metaDisplayName.message.length).toBeGreaterThan(0);
      }
      if (metaTag?.type === "simple") {
        expect(() => new Intl.NumberFormat(metaTag.message)).not.toThrow();
      }
      if (metaDirection?.type === "simple") {
        expect(["ltr", "rtl"]).toContain(metaDirection.message);
      }
    }
  });

  it("does not leave hardcoded user-visible copy in production TSX", () => {
    const leftover: string[] = [];
    for (const [path, source] of Object.entries(tsxSources)) {
      if (path.includes(".test.")) continue;
      for (const literal of uncatalogedJsxLiterals(source)) {
        leftover.push(`${path}: ${literal}`);
      }
    }
    expect(leftover).toEqual([]);
  });

  it("emits complete Chrome message catalogs for every registered locale", () => {
    for (const locale of APP_LOCALES) {
      const path = Object.keys(localeSources).find(
        (candidate) => localeFromPath(candidate) === locale,
      );
      expect(path, locale).toBeDefined();
      const parsed = parseMessagesText(localeSources[path!]!, "YAML");
      const chrome = generateChromeMessages(parsed);
      expect(Object.keys(chrome).length).toBeGreaterThan(50);
      expect(chrome.manifest_name?.message).toBeTruthy();
      expect(chrome.manifest_description?.message).toBeTruthy();
      expect(chrome.manifest_actionTitle?.message).toBeTruthy();
    }
  });
});
