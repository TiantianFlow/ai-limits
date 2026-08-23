import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FORBIDDEN_TRACKED_FILE_LITERALS } from "./artifact-contract.mjs";
import { verifyTrackedFiles } from "./verify-tracked-files.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

async function trackedFixture(contents) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-limits-tracked-gate-"));
  temporaryRoots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, "fixture.txt"), contents);
  execFileSync("git", ["add", "fixture.txt"], { cwd: root });
  return root;
}

describe("tracked-file reference gate", () => {
  it("accepts tracked files without forbidden literals", async () => {
    const root = await trackedFixture("neutral public repository content");
    await expect(verifyTrackedFiles(root)).resolves.toBeUndefined();
  });

  it("rejects a planted case-insensitive reference name", async () => {
    const referenceName = FORBIDDEN_TRACKED_FILE_LITERALS.find(
      (literal) =>
        literal.toLowerCase() === ["codex", "bar"].join(""),
    );
    expect(referenceName).toBeDefined();
    const root = await trackedFixture(
      `planted ${referenceName.toUpperCase()} reference`,
    );

    await expect(verifyTrackedFiles(root)).rejects.toThrow(
      /tracked files contain forbidden reference or release literals/i,
    );
  });
});
