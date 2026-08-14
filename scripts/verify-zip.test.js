import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, Zip, ZipPassThrough } from "fflate";

import * as artifactContract from "./artifact-contract.mjs";

const knownSyntheticCredentialLiterals = [
  "active-test-key",
  "candidate-key",
  "deferred-candidate-key",
  "ephemeral-api-key",
  "latest-key",
  "must-never-escape",
  "new-candidate-key",
  "not-a-real-elevenlabs-key",
  "old-key",
  "prior-active-key",
  "rejected-test-key",
  "replacement-key",
  "saved-key",
  "synthetic-api-key",
  "synthetic-candidate-key",
];

function zipWithDuplicateEntry(name, firstContents, secondContents) {
  const chunks = [];
  const archive = new Zip((error, data, final) => {
    if (error) throw error;
    chunks.push(data);
    if (final) return;
  });
  for (const contents of [firstContents, secondContents]) {
    const entry = new ZipPassThrough(name);
    archive.add(entry);
    entry.push(new TextEncoder().encode(contents), true);
  }
  archive.end();
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

describe("release ZIP credential scan", () => {
  it("rejects duplicate central-directory names before object decoding can hide malicious bytes", () => {
    const bytes = zipWithDuplicateEntry(
      "assets/app.js",
      "active-test-key",
      "release bytes",
    );

    expect(strFromU8(unzipSync(bytes)["assets/app.js"])).toBe("release bytes");
    expect(() => artifactContract.readValidatedReleaseZipEntries(bytes)).toThrow(
      "Duplicate ZIP entry name: assets/app.js.",
    );
  });

  it("accepts product prose and code-level header names without a value", () => {
    expect(
      artifactContract.validateReleaseTextEntries({
        "background.js":
          'const headerName="xi-api-key"; const endpoint="https://api.elevenlabs.io/v1/user/subscription";',
        "sidepanel.html": "Create and validate an ElevenLabs API key.",
      }),
    ).toEqual([]);
  });

  it.each(knownSyntheticCredentialLiterals)(
    "rejects known synthetic credential literal %s from release text",
    (literal) => {
      expect(
        artifactContract.validateReleaseTextEntries({ "background.js": literal }),
      ).toContain(
        `Release text contains synthetic credential literal: ${literal}.`,
      );
    },
  );

  it("rejects key-shaped values without treating ordinary API-key prose as a secret", () => {
    expect(
      artifactContract.validateReleaseTextEntries({
        "background.js": `const leaked = "sk_${"a".repeat(40)}";`,
      }),
    ).toContain(
      "Release text contains a key-shaped credential value in background.js.",
    );
    expect(
      artifactContract.validateReleaseTextEntries({
        "sidepanel.html": "Your API key is stored locally after validation.",
      }),
    ).toEqual([]);
  });

  it("requires ZIP, WXT output, and staged unpacked files to match exactly by path and bytes", () => {
    const baseline = {
      "manifest.json": Buffer.from('{"manifest_version":3}'),
      "assets/app.js": Buffer.from("release bytes"),
    };
    expect(
      artifactContract.validateReleaseArtifactParity({
        zip: baseline,
        output: baseline,
        dist: baseline,
      }),
    ).toEqual([]);

    expect(
      artifactContract.validateReleaseArtifactParity({
        zip: { ...baseline, "extra.js": Buffer.from("extra") },
        output: baseline,
        dist: {
          "manifest.json": baseline["manifest.json"],
          "assets/app.js": Buffer.from("different bytes"),
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "ZIP has unexpected file extra.js compared with WXT output.",
        "Staged unpacked bytes differ from WXT output for assets/app.js.",
      ]),
    );
  });

  it.each([
    ["../escape.js", "traversal"],
    ["/absolute.js", "absolute"],
    ["C:\\Users\\developer\\leak.js", "absolute"],
    [".superpowers/sdd/plan/task-8-report.md", "Superpowers"],
    ["docs/superpowers/private.md", "Superpowers"],
    ["assets/app.js.map", "source map"],
    [".env", "dotfile"],
    ["release-evidence/task-8-report.md", "generated evidence"],
  ])("rejects unsafe release entry %s", (entry, reason) => {
    expect(artifactContract.validateReleaseEntryNames([entry])).toEqual([
      expect.stringMatching(new RegExp(reason, "i")),
    ]);
  });

  it("rejects workstation paths and credential sentinels anywhere in artifact bytes", () => {
    const workstationPath = ["", "Users", "developer", "project"].join("/");
    expect(
      artifactContract.validateReleaseArtifactContents({
        "assets/app.js": Buffer.from(
          `${workstationPath} active-test-key ` + `sk_${"a".repeat(40)}`,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/workstation path/i),
        expect.stringMatching(/synthetic credential literal/i),
        expect.stringMatching(/key-shaped credential/i),
      ]),
    );
  });
});
