import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.join(process.cwd(), "entrypoints", "sidepanel", "styles.css"),
  "utf8",
);

describe("ElevenLabs API-key setup visual contract", () => {
  it("uses theme-specific primary colors with readable action text", () => {
    expect(styles).toContain("--action-primary: #6d28d9;");
    expect(styles).toContain("--action-primary-text: #ffffff;");
    expect(styles).toContain("--action-primary: #a78bfa;");
    expect(styles).toContain("--action-primary-text: #171717;");
    expect(styles).toMatch(
      /\.api-key-guide \.button--primary\s*\{[^}]*background:\s*var\(--action-primary\);[^}]*color:\s*var\(--action-primary-text\);/su,
    );
  });
});
