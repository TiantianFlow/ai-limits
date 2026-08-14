import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
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
  it("allows only canonical New API instance IDs in known storage tests", () => {
    expect(
      scan(
        "storage/repository.test.ts",
        `const apiKey = "${canonicalNewApiId}";\n`,
      ),
    ).toBe(0);
  });

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

  it("does not allowlist canonical instance IDs outside known storage tests", () => {
    expect(
      scan(
        "storage/unlisted.test.ts",
        `const apiKey = "${canonicalNewApiId}";\n`,
      ),
    ).toBe(1);
  });
});
