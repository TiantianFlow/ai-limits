import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function executableSources(directory) {
  const absolute = path.join(ROOT, directory);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return executableSources(relative);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      return [];
    }
    return [relative];
  });
}

function source(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function resolvedSourceImport(from, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(ROOT, path.dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  const absolute = candidates.find((candidate) => existsSync(candidate));
  return absolute ? path.relative(ROOT, absolute) : undefined;
}

describe("storage boundary contract", () => {
  it("exposes one final repository and credential implementation", () => {
    const temporaryFiles = [
      "storage/instance-repository.ts",
      "storage/credential-vault.ts",
      "storage/connection-suppressions.ts",
    ];
    expect(temporaryFiles.filter((file) => existsSync(path.join(ROOT, file)))).toEqual([]);
  });

  it("keeps released V4 decoding migration-local", () => {
    const legacyTokens = /\b(?:AppState|ProviderRecord|QuotaWindow|CreditBalance)\b|\.windows\b|\.credits\b/;
    const failures = ["domain", "providers", "storage", "background", "entrypoints"]
      .flatMap(executableSources)
      .filter((file) => file !== "storage/migration.ts" && legacyTokens.test(source(file)));
    expect(failures).toEqual([]);
  });

  it("keeps side-panel executable code on the public protocol boundary", () => {
    const boundaryViolation = /from\s+["']([^"']+)["']/g;
    const rawStorage = /(?:browser|chrome)\.storage\.local\.(?:get|set|remove)|aiLimits(?:State|Credentials|PermissionIntents)/;
    const failures = executableSources("entrypoints/sidepanel").flatMap((file) => {
      const text = source(file);
      const imports = [...text.matchAll(boundaryViolation)]
        .map((match) => match[1])
        .filter((specifier) =>
          specifier.includes("/domain/") ||
          specifier.includes("/providers/") ||
          specifier.includes("/storage/") ||
          specifier.includes("/background/"),
        );
      const invalidImports = imports.filter(
        (specifier) => !specifier.endsWith("/domain/public-protocol"),
      );
      return [
        ...invalidImports.map((specifier) => `${file}: ${specifier}`),
        ...(rawStorage.test(text) ? [`${file}: raw storage`] : []),
      ];
    });
    expect(failures).toEqual([]);
  });

  it("keeps public protocol free of credential and provider implementation imports", () => {
    expect(source("domain/public-protocol.ts")).not.toMatch(
      /from\s+["'][^"']*(?:storage|background|providers\/(?:types|registry|package-factories|[^/]+\/adapter)|credential|vault|migration|repository)[^"']*["']/,
    );
  });

  it("keeps the complete production side-panel import graph free of packages, collectors, and vaults", () => {
    const pending = executableSources("entrypoints/sidepanel");
    const visited = new Set();
    while (pending.length > 0) {
      const file = pending.pop();
      if (!file || visited.has(file)) continue;
      visited.add(file);
      for (const match of source(file).matchAll(/from\s+["']([^"']+)["']/g)) {
        const dependency = resolvedSourceImport(file, match[1]);
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }
    }
    expect(
      [...visited].filter((file) =>
        file.startsWith("providers/") ||
        file.startsWith("storage/") ||
        file.startsWith("background/"),
      ),
    ).toEqual([]);
    const reachable = [...visited].map(source).join("\n");
    expect(reachable).not.toMatch(
      /create(?:ApiKey|BrowserSession)Package|initializeCredentialVault|providerRegistry|\b(?:chatGpt|claude|cursor|elevenLabs|kimi|newApi)Adapter\b/,
    );
  });

  it("keeps provider configuration out of final credential serialization", () => {
    const credentials = source("storage/credentials.ts");
    expect(credentials).not.toMatch(/\bbaseUrl\b|dynamic-origin|ProviderInstanceConfig/);
    expect(credentials).not.toMatch(/\bproviderId\b|readProviderCredential|saveProviderApiKey/);
  });
});
