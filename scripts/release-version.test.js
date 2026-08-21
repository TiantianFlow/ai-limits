import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const buildVersion = "0.4.0";
const documentedReleaseVersion = "0.4.0";

function read(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("release version", () => {
  it("uses 0.4.0 as the package and verified manifest version", () => {
    const packageJson = JSON.parse(read("package.json"));
    const artifactContract = read("scripts/artifact-contract.mjs");

    expect(packageJson.version).toBe(buildVersion);
    expect(artifactContract).toContain(
      `manifest.version !== packageVersion || manifest.version !== "${buildVersion}"`,
    );
    expect(artifactContract).toContain(
      `Expected manifest version ${buildVersion} derived from package.json.`,
    );
  });

  it("names the 0.4.0 archive in build documentation", () => {
    for (const relativePath of ["README.md", "README.zh-CN.md"]) {
      const contents = read(relativePath);

      expect(contents).toContain(`ai-limits-${buildVersion}-chrome.zip`);
      expect(contents).not.toMatch(/ai-limits-0\.1\.[01]-chrome\.zip/);
    }
  });

  it("keeps the current Store archive reference at 0.4.0", () => {
    expect(read("STORE_LISTING.md")).toContain(
      `ai-limits-${documentedReleaseVersion}-chrome.zip`,
    );
  });

  it("describes the current release consistently in policy documents", () => {
    expect(read("PRIVACY.md")).toContain(
      `describes version ${documentedReleaseVersion}.`,
    );
    expect(read("STORE_LISTING.md")).toContain(
      `describes AI Limits version ${documentedReleaseVersion}.`,
    );
    expect(read("SECURITY.md")).toContain("latest 0.4.x release");
  });

  it("keeps personal email addresses out of public capture fixtures", () => {
    expect(read("scripts/capture-store-assets.mjs")).not.toMatch(
      /[A-Z0-9._%+-]+@gmail\.com/i,
    );
  });

  it("keeps local workstation paths out of tracked text files", () => {
    const textExtensions = new Set([
      ".css",
      ".html",
      ".js",
      ".json",
      ".md",
      ".mjs",
      ".ts",
      ".tsx",
    ]);
    const trackedFiles = execFileSync("git", ["ls-files", "-z"])
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .filter((file) => textExtensions.has(path.extname(file)));
    const offenders = trackedFiles.filter((file) =>
      /\/(?:Users|home)\/[^/]+\//u.test(read(file)),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps production side-panel modules directed away from background internals", () => {
    const productionSidePanelFiles = execFileSync(
      "git",
      ["ls-files", "-z", "entrypoints/sidepanel"],
    )
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .filter((file) => /\.(?:ts|tsx)$/u.test(file) && !file.includes(".test."));
    const offenders = productionSidePanelFiles.filter((file) =>
      /from\s+["'][^"']*background\//u.test(read(file)),
    );

    expect(offenders).toEqual([]);
  });
});
