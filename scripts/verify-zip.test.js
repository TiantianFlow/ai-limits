import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("missing test EOCD");
}

function zipLayout(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const entries = [];
  let centralOffset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    const centralNameLength = view.getUint16(centralOffset + 28, true);
    const centralExtraLength = view.getUint16(centralOffset + 30, true);
    const centralCommentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    entries.push({
      centralOffset,
      centralNameOffset: centralOffset + 46,
      centralNameLength,
      localOffset,
      localNameOffset: localOffset + 30,
      localNameLength,
      localExtraLength,
    });
    centralOffset +=
      46 + centralNameLength + centralExtraLength + centralCommentLength;
  }
  return {
    view,
    endOffset,
    centralDirectoryOffset,
    centralDirectorySize,
    entries,
  };
}

function releaseZip(entries = { "assets/app.js": "release bytes" }) {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, contents]) => [
        name,
        strToU8(contents),
      ]),
    ),
    { level: 6, mtime: new Date("1980-01-02T12:00:00.000Z") },
  );
}

function mutatedReleaseZip(mutate) {
  const bytes = releaseZip().slice();
  mutate(bytes, zipLayout(bytes));
  return bytes;
}

function insertBytes(bytes, offset, inserted) {
  const next = new Uint8Array(bytes.length + inserted.length);
  next.set(bytes.subarray(0, offset));
  next.set(inserted, offset);
  next.set(bytes.subarray(offset), offset + inserted.length);
  return next;
}

function zipWithCentralExtra(extra) {
  const bytes = releaseZip();
  const layout = zipLayout(bytes);
  const [entry] = layout.entries;
  const insertionOffset = entry.centralNameOffset + entry.centralNameLength;
  const next = insertBytes(bytes, insertionOffset, extra);
  const view = new DataView(next.buffer);
  view.setUint16(entry.centralOffset + 30, extra.length, true);
  view.setUint32(
    layout.endOffset + extra.length + 12,
    layout.centralDirectorySize + extra.length,
    true,
  );
  return next;
}

function zipWithLocalExtra(extra) {
  const bytes = releaseZip();
  const layout = zipLayout(bytes);
  const [entry] = layout.entries;
  const insertionOffset =
    entry.localNameOffset + entry.localNameLength + entry.localExtraLength;
  const next = insertBytes(bytes, insertionOffset, extra);
  const view = new DataView(next.buffer);
  view.setUint16(
    entry.localOffset + 28,
    entry.localExtraLength + extra.length,
    true,
  );
  view.setUint32(
    layout.endOffset + extra.length + 16,
    layout.centralDirectoryOffset + extra.length,
    true,
  );
  return next;
}

function zipWithCentralComment(comment) {
  const bytes = releaseZip();
  const layout = zipLayout(bytes);
  const [entry] = layout.entries;
  const next = insertBytes(bytes, layout.endOffset, comment);
  const view = new DataView(next.buffer);
  view.setUint16(entry.centralOffset + 32, comment.length, true);
  view.setUint32(
    layout.endOffset + comment.length + 12,
    layout.centralDirectorySize + comment.length,
    true,
  );
  return next;
}

function signatureBytes(signature, length) {
  const bytes = new Uint8Array(length);
  new DataView(bytes.buffer).setUint32(0, signature, true);
  return bytes;
}

function replaceEntryName(bytes, entry, name) {
  const encoded = strToU8(name);
  if (
    encoded.length !== entry.centralNameLength ||
    encoded.length !== entry.localNameLength
  ) {
    throw new Error("test replacement name length mismatch");
  }
  bytes.set(encoded, entry.centralNameOffset);
  bytes.set(encoded, entry.localNameOffset);
}

function zipWithDuplicateEntry(firstContents, secondContents) {
  const bytes = releaseZip({
    "assets/app.js": firstContents,
    "assets/alt.js": secondContents,
  });
  const layout = zipLayout(bytes);
  replaceEntryName(bytes, layout.entries[1], "assets/app.js");
  return bytes;
}

describe("release ZIP credential scan", () => {
  it.each([
    ["malicious first", "active-test-key", "release bytes"],
    ["malicious second", "release bytes", "active-test-key"],
  ])("rejects duplicate names before decoding when %s", (_case, first, second) => {
    const bytes = zipWithDuplicateEntry(first, second);

    expect(strFromU8(unzipSync(bytes)["assets/app.js"])).toBe(second);
    expect(() => artifactContract.readValidatedReleaseZipEntries(bytes)).toThrow(
      "Duplicate ZIP entry name: assets/app.js.",
    );
  });

  it("rejects an invalid referenced local-header signature", () => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      new DataView(mutated.buffer).setUint32(entry.localOffset, 0xdeadbeef, true);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/local-header signature/i);
  });

  it("rejects a traversal local name hidden behind a safe central name", () => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      mutated.set(strToU8("../escape.jsx"), entry.localNameOffset);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/local.*traversal/i);
  });

  it.each([
    [
      "central compressed size",
      (view, entry) =>
        view.setUint32(entry.centralOffset + 20, 0xffffffff, true),
    ],
    [
      "central uncompressed size",
      (view, entry) =>
        view.setUint32(entry.centralOffset + 24, 0xffffffff, true),
    ],
    [
      "central local offset",
      (view, entry) =>
        view.setUint32(entry.centralOffset + 42, 0xffffffff, true),
    ],
    [
      "central disk start",
      (view, entry) =>
        view.setUint16(entry.centralOffset + 34, 0xffff, true),
    ],
    [
      "local compressed size",
      (view, entry) =>
        view.setUint32(entry.localOffset + 18, 0xffffffff, true),
    ],
    [
      "local uncompressed size",
      (view, entry) =>
        view.setUint32(entry.localOffset + 22, 0xffffffff, true),
    ],
  ])("rejects the ZIP64 sentinel in %s", (_field, mutate) => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      mutate(new DataView(mutated.buffer), entry);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/ZIP64/i);
  });

  it.each([
    [
      "central",
      () => zipWithCentralExtra(Uint8Array.of(0x01, 0x00, 0x00, 0x00)),
    ],
    [
      "local",
      () => zipWithLocalExtra(Uint8Array.of(0x01, 0x00, 0x00, 0x00)),
    ],
  ])("rejects a %s ZIP64 extra field", (_header, makeZip) => {
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(makeZip()),
    ).toThrow(/ZIP64 extra/i);
  });

  it.each([
    ["central only", true, false],
    ["local only", false, true],
    ["both headers without a descriptor", true, true],
  ])("rejects the data-descriptor flag in %s", (_case, central, local) => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      const view = new DataView(mutated.buffer);
      if (central) view.setUint16(entry.centralOffset + 8, 0x0008, true);
      if (local) view.setUint16(entry.localOffset + 6, 0x0008, true);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/data descriptor/i);
  });

  it.each([
    ["encrypted", 0x0001, /encrypt/i],
    ["reserved flag", 0x4000, /unsupported.*flag/i],
  ])("rejects %s entries", (_case, flags, error) => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      const view = new DataView(mutated.buffer);
      view.setUint16(entry.centralOffset + 8, flags, true);
      view.setUint16(entry.localOffset + 6, flags, true);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(error);
  });

  it.each([
    [
      "method",
      (view, entry) => view.setUint16(entry.localOffset + 8, 0, true),
    ],
    [
      "compressed size",
      (view, entry) =>
        view.setUint32(
          entry.localOffset + 18,
          view.getUint32(entry.localOffset + 18, true) + 1,
          true,
        ),
    ],
    [
      "uncompressed size",
      (view, entry) =>
        view.setUint32(
          entry.localOffset + 22,
          view.getUint32(entry.localOffset + 22, true) + 1,
          true,
        ),
    ],
    [
      "CRC",
      (view, entry) =>
        view.setUint32(
          entry.localOffset + 14,
          view.getUint32(entry.localOffset + 14, true) ^ 1,
          true,
        ),
    ],
  ])("rejects a local-central %s mismatch", (_field, mutate) => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      mutate(new DataView(mutated.buffer), entry);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(new RegExp(`${_field}.*mismatch`, "i"));
  });

  it("rejects a local-central filename mismatch even when both names are safe", () => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      mutated.set(strToU8("assets/alt.js"), entry.localNameOffset);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/name.*mismatch/i);
  });

  it("rejects a method outside the generated stored/deflated set", () => {
    const bytes = mutatedReleaseZip((mutated, { entries: [entry] }) => {
      const view = new DataView(mutated.buffer);
      view.setUint16(entry.centralOffset + 10, 12, true);
      view.setUint16(entry.localOffset + 8, 12, true);
    });
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/unsupported.*method/i);
  });

  it("rejects a compressed data span that reaches into the central directory", () => {
    const bytes = mutatedReleaseZip(
      (mutated, { centralDirectoryOffset, entries: [entry] }) => {
        const view = new DataView(mutated.buffer);
        view.setUint32(entry.centralOffset + 20, centralDirectoryOffset, true);
        view.setUint32(entry.localOffset + 18, centralDirectoryOffset, true);
      },
    );
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/compressed data.*bounds/i);
  });

  it("rejects two central records that reference the same local header", () => {
    const bytes = releaseZip({
      "assets/app.js": "release bytes",
      "assets/alt.js": "other bytes",
    });
    const layout = zipLayout(bytes);
    layout.view.setUint32(
      layout.entries[1].centralOffset + 42,
      layout.entries[0].localOffset,
      true,
    );
    expect(() =>
      artifactContract.readReleaseZipCentralDirectoryNames(bytes),
    ).toThrow(/duplicate local-header offset/i);
  });

  it.each([
    ["EOCD64 locator", 0x07064b50, 20],
    ["EOCD64 record", 0x06064b50, 56],
  ])(
    "rejects an ambiguous %s signature before EOCD",
    (_case, signature, length) => {
      const bytes = zipWithCentralComment(signatureBytes(signature, length));
      expect(() =>
        artifactContract.readReleaseZipCentralDirectoryNames(bytes),
      ).toThrow(/ZIP64/i);
    },
  );

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
        `Release text contains forbidden literal: ${literal}.`,
      );
    },
  );

  it("rejects forbidden reference names case-insensitively", () => {
    const referenceName = artifactContract.FORBIDDEN_RELEASE_LITERALS.find(
      (literal) =>
        literal.toLowerCase() === ["codex", "bar"].join(""),
    );
    expect(referenceName).toBeDefined();
    expect(
      artifactContract.validateReleaseTextEntries({
        "background.js": referenceName.toUpperCase(),
      }),
    ).toContain(`Release text contains forbidden literal: ${referenceName}.`);
  });

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
        expect.stringMatching(/forbidden literal/i),
        expect.stringMatching(/key-shaped credential/i),
      ]),
    );
  });
});
