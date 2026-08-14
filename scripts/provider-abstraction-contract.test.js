import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { providerRegistry } from "../providers/registry";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["domain", "providers", "storage", "background", "entrypoints"];
const FORBIDDEN_BRIDGES = [
  "domain/instances.ts",
  "providers/initial-state.ts",
  "providers/v4-wire-migration.ts",
  "storage/connection-suppressions.ts",
  "storage/credential-vault.ts",
  "storage/instance-repository.ts",
];
const DEPRECATED_TYPES = [
  "ProviderId",
  "ApiKeyProviderId",
  "AppState",
  "ProviderRecord",
  "ProviderAdapter",
  "RefreshCollector",
];

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

describe("provider abstraction contract", () => {
  it("has no temporary provider, domain, or migration bridge modules", () => {
    expect(FORBIDDEN_BRIDGES.filter((file) => existsSync(path.join(ROOT, file)))).toEqual([]);
  });

  it("has no deprecated provider or V4 runtime type references in executable source", () => {
    const failures = SOURCE_ROOTS.flatMap(executableSources).flatMap((file) => {
      if (file === "storage/migration.ts") return [];
      const text = source(file);
      return DEPRECATED_TYPES.filter((name) => new RegExp(`\\b${name}\\b`).test(text)).map(
        (name) => `${file}: ${name}`,
      );
    });
    expect(failures).toEqual([]);
  });

  it("keeps mutable provider-kind maps out of central runtime and storage", () => {
    const failures = ["background", "storage", "domain"].flatMap(executableSources).filter((file) => {
      if (file === "storage/migration.ts") return false;
      return /\b(?:Map|Record|Partial\s*<\s*Record)\s*<\s*(?:ProviderKind|ApiKeyProviderKind)\b/.test(
        source(file),
      );
    });
    expect(failures).toEqual([]);
  });

  it("keeps provider-literal behavior branches out of central runtime and storage", () => {
    const providerLiteral = /["'](?:chatgpt|claude|kimi|cursor|elevenlabs|newapi)["']/;
    const failures = ["background", "storage"].flatMap(executableSources).filter((file) => {
      if (file === "storage/migration.ts") return false;
      return providerLiteral.test(source(file));
    });
    expect(failures).toEqual([]);
  });

  it("keeps central runtime and storage behavior on the package registry boundary", () => {
    const failures = ["background", "storage", "domain"]
      .flatMap(executableSources)
      .filter((file) => file !== "storage/migration.ts" && /\bproviderCatalog\s*\[/.test(source(file)));
    expect(failures).toEqual([]);
  });

  it("keeps every static package behavior-complete", () => {
    for (const providerPackage of Object.values(providerRegistry)) {
      expect(["single", "multiple"]).toContain(providerPackage.cardinality);
      expect(typeof providerPackage.normalizeConfig).toBe("function");
      expect(typeof providerPackage.requiredPermissions).toBe("function");
      expect(typeof providerPackage.collect).toBe("function");
    }
  });
});
