import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(path.join(process.cwd(), "vitest.config.ts"), "utf8");

describe("Vitest discovery", () => {
  it("preserves the defaults and excludes linked worktrees", () => {
    expect(config).toMatch(
      /exclude:\s*\[\.\.\.configDefaults\.exclude,\s*"\*\*\/\.worktrees\/\*\*"\]/,
    );
  });
});
