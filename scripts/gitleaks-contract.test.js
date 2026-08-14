import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];
const configPath = path.join(process.cwd(), ".gitleaks.toml");
const canonicalNewApiId = [
  "newapi:",
  "0c5f2af7",
  "-21d4",
  "-4cd1",
  "-bcd8",
  "-09005c65e45f",
].join("");
const nonUuidNewApiValue = [
  "newapi:",
  "2f835c1f44a04afe",
  "982b0f3c6883c4cf",
].join("");
const genericApiKey = [
  "abcdef0123456789",
  "abcdef0123456789",
].join("");
const knownStorageTestPaths = [
  "storage/credentials.test.ts",
  "storage/repository.test.ts",
  "storage/state-codec.test.ts",
];
const historicalCanonicalIdCommits = [
  "748806948496ec12ef53d6b6a1abba79e5fd39ca",
  "8f23718971f841c1b733b3a98eba84ce71730ad6",
  "b8856acf6b266ef09e5b97ddf887fb0e6ee189c3",
];

function scan(relativePath, contents) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ai-limits-gitleaks-"));
  temporaryDirectories.push(directory);
  const fixturePath = path.join(directory, relativePath);
  mkdirSync(path.dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, contents);
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync("git", ["add", "--", relativePath], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=AI Limits",
      "-c",
      "user.email=tests@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: directory },
  );

  try {
    execFileSync(
      "gitleaks",
      [
        "detect",
        "--no-banner",
        "--redact",
        "--config",
        configPath,
        "--source",
        directory,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
    return 0;
  } catch (error) {
    return error.status;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("gitleaks repository contract", () => {
  it("scopes renamed historical fixtures by exact commit without dead paths", () => {
    const config = readFileSync(configPath, "utf8");
    expect(
      [...config.matchAll(/\b[0-9a-f]{40}\b/gu)].map(([commit]) => commit).sort(),
    ).toEqual([...historicalCanonicalIdCommits].sort());
    expect(config).not.toMatch(/credential-vault|instance-repository/u);
  });

  it.each(knownStorageTestPaths)(
    "allows canonical New API instance IDs in current storage contract %s",
    (relativePath) => {
      expect(
        scan(relativePath, `const apiKey = "${canonicalNewApiId}";\n`),
      ).toBe(0);
    },
  );

  it("still rejects a non-UUID New API value in a known storage test", () => {
    expect(
      scan(
        "storage/repository.test.ts",
        `const apiKey = "${nonUuidNewApiValue}";\n`,
      ),
    ).toBe(1);
  });

  it("still rejects an ordinary generic API key in a known storage test", () => {
    expect(
      scan(
        "storage/repository.test.ts",
        `const apiKey = "${genericApiKey}";\n`,
      ),
    ).toBe(1);
  });

  it.each([
    "storage/credential-vault.test.ts",
    "storage/instance-repository.test.ts",
    "storage/unlisted.test.ts",
  ])(
    "does not allowlist canonical instance IDs in noncurrent path %s",
    (relativePath) => {
      expect(
        scan(relativePath, `const apiKey = "${canonicalNewApiId}";\n`),
      ).toBe(1);
    },
  );
});
