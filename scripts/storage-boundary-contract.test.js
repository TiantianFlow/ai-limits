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
    const forbiddenImport = /from\s+["'][^"']*(?:storage|background|providers\/registry|credential|vault|migration|repository)[^"']*["']/;
    const rawStorage = /(?:browser|chrome)\.storage\.local\.(?:get|set|remove)|aiLimits(?:State|Credentials|PermissionIntents)/;
    const failures = executableSources("entrypoints/sidepanel").filter((file) => {
      const text = source(file);
      return forbiddenImport.test(text) || rawStorage.test(text);
    });
    expect(failures).toEqual([]);
  });

  it("keeps provider configuration out of final credential serialization", () => {
    const credentials = source("storage/credentials.ts");
    expect(credentials).not.toMatch(/\bbaseUrl\b|dynamic-origin|ProviderInstanceConfig/);
    expect(credentials).not.toMatch(/\bproviderId\b|readProviderCredential|saveProviderApiKey/);
  });
});
