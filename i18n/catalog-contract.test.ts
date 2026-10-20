// @vitest-environment node

import {
  generateChromeMessages,
  parseMessagesText,
  SUPPORTED_LOCALES,
  type ParsedMessage,
} from "@wxt-dev/i18n/build";
import { parseAst, transformWithEsbuild } from "vite";
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
  "↑",
  "↓",
  "·",
  "—",
  "User → Read",
  "/v1/messages",
  "/api/status",
  "/api/usage/token/",
]);
const ALLOWED_LITERAL_RE =
  /^(used|left|general|model|feature|product|elapsed|remaining|default|USD|chatgpt|claude|kimi|cursor|grok|elevenlabs|newapi|litellm|clawrouter|sub2api|llmProxy)$/;

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

const COPY_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt"]);

interface AstNode {
  type: string;
  [field: string]: unknown;
}

function isCopy(text: string): boolean {
  return (
    /[A-Za-z]/.test(text) &&
    !ALLOWED_JSX_TEXT.has(text) &&
    !ALLOWED_LITERAL_RE.test(text) &&
    !/^[a-z0-9-]+$/.test(text)
  );
}

function stringValue(node: unknown): string | undefined {
  const value = node as AstNode | undefined;
  return value?.type === "Literal" && typeof value.value === "string"
    ? value.value.trim()
    : undefined;
}

function propertyName(node: AstNode): string | undefined {
  const key = node.key as AstNode;
  return key.type === "Identifier" ? String(key.name) : stringValue(key);
}

/**
 * JSX text and copy attributes (aria-label, title, placeholder, alt) that are
 * string literals. esbuild compiles the JSX to jsx() calls, so the walk sees
 * exactly the strings React would render, not text that merely sits between
 * `>` and `<` in the source.
 */
async function uncatalogedJsxLiterals(source: string, path: string): Promise<string[]> {
  const { code } = await transformWithEsbuild(source, path, { jsx: "automatic" });
  const program = parseAst(code) as unknown as AstNode;
  const jsxFactories = new Set<string>();
  const literals: string[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object" || typeof (node as AstNode).type !== "string") return;
    const current = node as AstNode;
    if (current.type === "ImportDeclaration" && stringValue(current.source) === "react/jsx-runtime") {
      for (const specifier of current.specifiers as AstNode[]) {
        jsxFactories.add(String((specifier.local as AstNode).name));
      }
    }
    const callee = current.callee as AstNode | undefined;
    const props = (current.arguments as AstNode[] | undefined)?.[1];
    if (
      current.type === "CallExpression" &&
      callee?.type === "Identifier" &&
      jsxFactories.has(String(callee.name)) &&
      props?.type === "ObjectExpression"
    ) {
      for (const property of props.properties as AstNode[]) {
        if (property.type !== "Property") continue;
        const name = propertyName(property);
        const values = name === "children"
          ? [property.value, ...((property.value as AstNode).type === "ArrayExpression"
            ? ((property.value as AstNode).elements as unknown[])
            : [])]
          : COPY_ATTRIBUTES.has(name ?? "") ? [property.value] : [];
        for (const value of values) {
          const text = stringValue(value);
          if (text && isCopy(text)) literals.push(text);
        }
      }
    }
    for (const [field, child] of Object.entries(current)) {
      if (field !== "type") visit(child);
    }
  };

  visit(program);
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

  it("finds rendered literals and ignores code between angle brackets", async () => {
    const source = `
      export const View = ({ at, a, b, t }) => (
        <section title="Close dialog" aria-label={t("label")} data-x="Not copy">
          Hello world
          <b>{at > a && at < b}</b>
          {"Inline copy"}
          <span className="provider-row">+</span>
        </section>
      );`;
    expect(await uncatalogedJsxLiterals(source, "View.tsx")).toEqual([
      "Close dialog",
      "Hello world",
      "Inline copy",
    ]);
  });

  it("does not leave hardcoded user-visible copy in production TSX", async () => {
    const leftover: string[] = [];
    for (const [path, source] of Object.entries(tsxSources)) {
      if (path.includes(".test.")) continue;
      for (const literal of await uncatalogedJsxLiterals(source, path)) {
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
