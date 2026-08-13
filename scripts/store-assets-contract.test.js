import { deflateSync } from "node:zlib";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import * as storeAssetContract from "./store-assets-contract.mjs";
import {
  FIDELITY_ARTIFACT_ID,
  FIDELITY_FILES_RESPONSE_SHA256,
  FIDELITY_FIXED_CLOCK,
  FIDELITY_MISSING_SOURCE_FILES,
  FIDELITY_UNRESOLVED_IMPORTS,
  STORE_ASSET_CAPTURES,
  buildPinnedReferenceInventory,
  buildFidelityPreviewQuery,
  captureMatchesSha256,
  createFidelityCaptureMatrix,
  extractCssCustomProperties,
  fidelityScreenHasModeControl,
  readPngDimensions,
  resolveContainedCapturePath,
  resolveFidelitySnapshotDirectory,
  parseMcpSseResponse,
  pacingCardScrollTop,
  validateFidelityReferenceManifest,
  validateFidelityProductionManifest,
  validateStoreAssetDimensions,
} from "./store-assets-contract.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodedPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  const pixels = Buffer.alloc((width * 4 + 1) * height);

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("store assets", () => {
  it("waits for document fonts before capturing store artwork", async () => {
    let fontsReady = false;
    const originalFonts = document.fonts;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve().then(() => {
          fontsReady = true;
        }),
      },
    });

    try {
      const page = {
        evaluate: async (callback) => callback(),
      };

      await storeAssetContract.waitForDocumentFonts(page);

      expect(fontsReady).toBe(true);
    } finally {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: originalFonts,
      });
    }
  });

  it("requires an explicit absolute fidelity snapshot directory", () => {
    expect(() =>
      resolveFidelitySnapshotDirectory({ argv: [], env: {} }),
    ).toThrow(/--snapshot-dir.*AI_LIMITS_FIDELITY_SNAPSHOT_DIR/i);
    expect(() =>
      resolveFidelitySnapshotDirectory({
        argv: ["--snapshot-dir", "relative/snapshot"],
        env: {},
      }),
    ).toThrow(/absolute/i);
    expect(() =>
      resolveFidelitySnapshotDirectory({
        argv: ["--snapshot-dir", "/"],
        env: {},
      }),
    ).toThrow(/filesystem root/i);
  });

  it("resolves the fidelity snapshot from CLI or environment without ambiguity", () => {
    expect(
      resolveFidelitySnapshotDirectory({
        argv: ["--snapshot-dir", "/tmp/pinned-magic-export"],
        env: {},
      }),
    ).toBe("/tmp/pinned-magic-export");
    expect(
      resolveFidelitySnapshotDirectory({
        argv: [],
        env: {
          AI_LIMITS_FIDELITY_SNAPSHOT_DIR: "/private/tmp/pinned-magic-export",
        },
      }),
    ).toBe("/private/tmp/pinned-magic-export");
    expect(() =>
      resolveFidelitySnapshotDirectory({
        argv: ["--snapshot-dir=/tmp/one"],
        env: { AI_LIMITS_FIDELITY_SNAPSHOT_DIR: "/tmp/two" },
      }),
    ).toThrow(/conflicting/i);
    expect(() =>
      resolveFidelitySnapshotDirectory({
        argv: ["--snapshot-dir"],
        env: {},
      }),
    ).toThrow(/requires a value/i);
    for (const argv of [
      [
        "--snapshot-dir",
        "/tmp/pinned-magic-export",
        "--snapshot-dir",
        "/tmp/pinned-magic-export",
      ],
      [
        "--snapshot-dir=/tmp/pinned-magic-export",
        "--snapshot-dir=/tmp/pinned-magic-export",
      ],
      [
        "--snapshot-dir=/tmp/pinned-magic-export",
        "--snapshot-dir",
        "/tmp/pinned-magic-export",
      ],
    ]) {
      expect(() =>
        resolveFidelitySnapshotDirectory({ argv, env: {} }),
      ).toThrow(/only once/i);
    }
  });

  it("positions the featured pacing card below sticky panel chrome", () => {
    expect(
      pacingCardScrollTop({
        cardOffsetTop: 788,
        stickyHeight: 110,
        scrollHeight: 1400,
        clientHeight: 698,
      }),
    ).toBe(670);
    expect(
      pacingCardScrollTop({
        cardOffsetTop: 50,
        stickyHeight: 110,
        scrollHeight: 700,
        clientHeight: 698,
      }),
    ).toBe(0);
  });

  it("extracts CSS custom-property declarations without treating BEM pseudo-classes as tokens", () => {
    expect(
      extractCssCustomProperties(`
        :root { --surface: #fff; --focus: rgb(10 20 30 / 50%); }
        .button--secondary:disabled { cursor: wait; }
      `),
    ).toEqual({
      "--surface": "#fff",
      "--focus": "rgb(10 20 30 / 50%)",
    });
  });

  it("confines reference capture paths and validates their bytes against the manifest hash", () => {
    expect(resolveContainedCapturePath("/tmp/reference", "nested/capture.png")).toBe(
      "/tmp/reference/nested/capture.png",
    );
    expect(() =>
      resolveContainedCapturePath("/tmp/reference", "../escape.png"),
    ).toThrow(/escapes/i);
    expect(() =>
      resolveContainedCapturePath("/tmp/reference", "/tmp/absolute.png"),
    ).toThrow(/escapes/i);

    const bytes = Buffer.from("pinned reference bytes", "utf8");
    expect(
      captureMatchesSha256(
        bytes,
        "45c4680726aa2dfb5254ac9b44f5393aa9d9a99df0db8334bf229448158b6729",
      ),
    ).toBe(true);
    expect(captureMatchesSha256(bytes, "0".repeat(64))).toBe(false);
  });

  it("parses the saved MCP SSE envelope and inventories missing artifact source", () => {
    const sse = (text) =>
      `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text }] } })}\n`;
    const artifactId = "90076f25-e8be-4bce-9b9e-77af020bc08d";
    const statusResponse = sse(
      JSON.stringify({
        isGenerating: false,
        activeArtifactId: artifactId,
        availableFiles: ["App.tsx", "components/Missing.tsx"],
      }),
    );
    const artifactResponse = sse(
      `Artifact ID: ${artifactId}\n\nFiles:\n- App.tsx\n- components/Missing.tsx`,
    );
    const filesResponse = sse(
      JSON.stringify({
        files: [
          {
            name: "App.tsx",
            content:
              "import React from 'react'\nimport { Missing } from './components/Missing'\nexport const App = () => <Missing />\n",
          },
        ],
      }),
    );
    const historyResponse = sse(
      JSON.stringify({ items: [{ artifactId }], hasMore: true }),
    );

    expect(parseMcpSseResponse(statusResponse)).toEqual(
      expect.objectContaining({ activeArtifactId: artifactId }),
    );
    expect(
      buildPinnedReferenceInventory({
        statusResponse,
        artifactResponse,
        filesResponse,
        historyResponse,
      }),
    ).toEqual(
      expect.objectContaining({
        artifactId,
        referenceRenderable: false,
        missingSourceFiles: ["components/Missing.tsx"],
        unresolvedImports: [
          {
            importer: "App.tsx",
            specifier: "./components/Missing",
          },
        ],
        externalDependencies: ["react"],
        historyHasArtifactId: true,
        historyHasMore: true,
        sourceFiles: [
          {
            path: "App.tsx",
            content: expect.any(String),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        ],
        filesResponseSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("gives every store capture an explicit fixture source and fixed clock", () => {
    expect(STORE_ASSET_CAPTURES).toHaveLength(9);
    expect(
      STORE_ASSET_CAPTURES.every(
        (capture) =>
          capture.dataSource === "fixture" &&
          capture.fixedClock === FIDELITY_FIXED_CLOCK,
      ),
    ).toBe(true);
  });

  it("adds one deterministic GitHub social preview to the marketing captures", () => {
    expect(storeAssetContract.MARKETING_ASSET_CAPTURES).toHaveLength(10);
    expect(storeAssetContract.MARKETING_ASSET_CAPTURES).toContainEqual({
      locale: "en",
      view: "social",
      relativePath: "github/social-preview-1280x640.png",
      viewport: { width: 1280, height: 640 },
      dataSource: "fixture",
      fixedClock: FIDELITY_FIXED_CLOCK,
    });
  });

  it("builds the complete responsive fidelity screen and state matrix", () => {
    const matrix = createFidelityCaptureMatrix();
    const baseScreens = [
      "first-run",
      "overview",
      "provider-detail",
      "history",
      "add-provider",
      "settings",
      "api-key-connect",
    ];

    expect(matrix).toHaveLength(72);
    expect(new Set(matrix.map((capture) => capture.id)).size).toBe(72);
    for (const width of [340, 400, 460]) {
      for (const theme of ["light", "dark"]) {
        for (const screen of baseScreens) {
          expect(matrix).toContainEqual(
            expect.objectContaining({
              screen,
              state: "default",
              mode: "used",
              theme,
              viewport: { width, height: 900 },
              fixedClock: "2026-08-09T14:00:00.000Z",
              dataSource: "fixture",
              locale: "en-US",
            }),
          );
        }
      }
    }

    expect(new Set(matrix.map(({ state }) => state))).toEqual(
      new Set([
        "default",
        "refresh-pending",
        "partial-refresh",
        "kimi-interaction",
        "delete-confirmation",
      ]),
    );
    expect(matrix).toContainEqual(
      expect.objectContaining({
        screen: "overview",
        state: "default",
        mode: "left",
      }),
    );
  });

  it("declares keyboard-only activation for every routed fidelity screen", () => {
    const matrix = createFidelityCaptureMatrix();
    const capture = (screen, state = "default") =>
      matrix.find(
        (candidate) =>
          candidate.screen === screen &&
          candidate.state === state &&
          candidate.viewport.width === 400 &&
          candidate.theme === "light",
      );

    expect(capture("overview").keyboardNavigation).toEqual([]);
    expect(capture("first-run").keyboardNavigation).toEqual([]);
    expect(capture("provider-detail").keyboardNavigation).toEqual([
      {
        selector: 'button[aria-label="Open Kimi details"]',
        readySelector: '[aria-label="Kimi detail"]',
        key: "Enter",
      },
    ]);
    expect(capture("history").keyboardNavigation).toEqual([
      {
        selector: 'button[aria-label="Open Kimi history for 5-hour usage"]',
        readySelector: '[aria-label="Kimi history"]',
        key: "Space",
      },
    ]);
    expect(capture("api-key-connect").keyboardNavigation).toEqual([
      {
        selector: 'button[aria-label="Settings"]',
        readySelector: '[aria-label="Provider settings"]',
        key: "Space",
      },
      {
        selector: 'button[aria-label="Replace ElevenLabs API key"]',
        readySelector: '[aria-label="Replace ElevenLabs API key"]',
        key: "Enter",
      },
    ]);
    expect(capture("settings", "delete-confirmation").keyboardNavigation).toEqual([
      {
        selector: 'button[aria-label="Settings"]',
        readySelector: '[aria-label="Provider settings"]',
        key: "Space",
      },
      {
        selector: ".danger-zone__trigger",
        readySelector: '[aria-label="Confirm local data deletion"]',
        key: "Enter",
      },
    ]);
  });

  it("requires a visible Used/Left selector only on screens that own one", () => {
    expect(fidelityScreenHasModeControl("overview")).toBe(true);
    expect(fidelityScreenHasModeControl("history")).toBe(true);
    for (const screen of [
      "first-run",
      "provider-detail",
      "add-provider",
      "settings",
      "api-key-connect",
    ]) {
      expect(fidelityScreenHasModeControl(screen)).toBe(false);
    }
  });

  it("serializes every deterministic preview input into the capture URL", () => {
    expect(
      buildFidelityPreviewQuery({
        screen: "provider-detail",
        state: "kimi-interaction",
        mode: "used",
        theme: "dark",
        viewport: { width: 460, height: 900 },
        fixedClock: FIDELITY_FIXED_CLOCK,
        dataSource: "fixture",
        locale: "en-US",
      }),
    ).toBe(
      "fidelity=1&screen=provider-detail&state=kimi-interaction&mode=used&theme=dark&panelWidth=460&dataSource=fixture&fixedClock=2026-08-09T14%3A00%3A00.000Z&locale=en-US",
    );
  });

  it("requires the pinned artifact identity, response hash, source hashes, and capture fields", () => {
    const valid = {
      schemaVersion: 1,
      artifactId: FIDELITY_ARTIFACT_ID,
      responseFiles: [
        {
          name: "status-response",
          path: "raw/status-response",
          sha256: "eae5108294cdf028b7c78685ae7f4dc72c30fbaf78d36ae5b1d02fb95ae27cba",
        },
        {
          name: "artifact-response",
          path: "raw/artifact-response",
          sha256: "25293caa928986da87fc38caf17bb037b9d9ff893e53686ae976976b0f1ea648",
        },
        {
          name: "history-response",
          path: "raw/history-response",
          sha256: "ec2faab8338c8e97748bc64128fcbb66f1414ddfd989970620936e5cbd898eec",
        },
        {
          name: "files-response",
          path: "raw/files-response",
          sha256: FIDELITY_FILES_RESPONSE_SHA256,
        },
      ],
      filesResponse: {
        path: "raw/files-response",
        sha256: FIDELITY_FILES_RESPONSE_SHA256,
      },
      sourceFiles: [
        { path: "App.tsx", sha256: "a".repeat(64) },
        { path: "index.css", sha256: "b".repeat(64) },
      ],
      harnessPatch: {
        path: "harness.patch",
        sha256: "c".repeat(64),
      },
      sourceComparison: {
        path: "source-comparison.json",
        sha256: "d".repeat(64),
      },
      referenceRenderable: false,
      referenceStatus: "blocked",
      missingSourceFiles: FIDELITY_MISSING_SOURCE_FILES,
      unresolvedImports: FIDELITY_UNRESOLVED_IMPORTS,
      captures: createFidelityCaptureMatrix().map((capture) => ({
        ...capture,
        status: "blocked-missing-source",
      })),
    };

    expect(validateFidelityReferenceManifest(valid)).toEqual([]);
    expect(
      validateFidelityReferenceManifest({
        ...valid,
        artifactId: "wrong-artifact",
        filesResponse: { ...valid.filesResponse, sha256: "d".repeat(64) },
        sourceFiles: [{ path: "App.tsx", sha256: "not-a-hash" }],
        captures: [{ id: "incomplete" }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/artifact ID/i),
        expect.stringMatching(/files response/i),
        expect.stringMatching(/source file/i),
        expect.stringMatching(/complete.*matrix/i),
        expect.stringMatching(/viewport/i),
        expect.stringMatching(/theme/i),
        expect.stringMatching(/screen/i),
        expect.stringMatching(/state/i),
        expect.stringMatching(/fixed clock/i),
      ]),
    );

    for (const referenceRenderable of [undefined, true]) {
      expect(
        validateFidelityReferenceManifest({
          ...valid,
          referenceRenderable,
        }),
      ).toEqual(
        expect.arrayContaining([expect.stringMatching(/non-renderable/i)]),
      );
    }

    expect(
      validateFidelityReferenceManifest({
        ...valid,
        captures: valid.captures.map((capture, index) =>
          index === 0
            ? {
                ...capture,
                status: "captured",
                path: `${capture.id}.png`,
                sha256: "f".repeat(64),
              }
            : capture,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/blocked-missing-source/i),
        expect.stringMatching(/image path/i),
      ]),
    );

    expect(
      validateFidelityReferenceManifest({
        ...valid,
        filesResponse: {
          ...valid.filesResponse,
          path: "/tmp/pinned-magic-export/files-response",
        },
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/relative.*path/i)]));

    expect(
      validateFidelityReferenceManifest({
        ...valid,
        captures: [...valid.captures].reverse(),
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/capture.*order/i)]));

    expect(
      validateFidelityReferenceManifest({
        ...valid,
        captures: valid.captures.map((capture, index) =>
          index === 0 ? { ...capture, locale: "fr-CA" } : capture,
        ),
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/locale/i)]));
  });

  it("rejects arbitrary and shuffled extracted source hashes", () => {
    expect(typeof storeAssetContract.validatePinnedReferenceInventory).toBe(
      "function",
    );
    if (typeof storeAssetContract.validatePinnedReferenceInventory !== "function") {
      return;
    }

    const inventory = {
      advertisedFiles: ["App.tsx", "index.css"],
      sourceFiles: [
        { path: "App.tsx", content: "app", sha256: "a".repeat(64) },
        { path: "index.css", content: "css", sha256: "b".repeat(64) },
      ],
      missingSourceFiles: [],
      unresolvedImports: [],
    };
    const manifest = {
      advertisedFiles: inventory.advertisedFiles,
      sourceFiles: inventory.sourceFiles.map(({ path: sourcePath, content, sha256 }) => ({
        path: sourcePath,
        bytes: Buffer.byteLength(content),
        sha256,
      })),
      missingSourceFiles: [],
      unresolvedImports: [],
    };

    expect(
      storeAssetContract.validatePinnedReferenceInventory(manifest, inventory),
    ).toEqual([]);
    expect(
      storeAssetContract.validatePinnedReferenceInventory(
        {
          ...manifest,
          sourceFiles: manifest.sourceFiles.map((source, index) =>
            index === 0 ? { ...source, sha256: "c".repeat(64) } : source,
          ),
        },
        inventory,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/source.*hash/i)]));
    expect(
      storeAssetContract.validatePinnedReferenceInventory(
        { ...manifest, sourceFiles: [...manifest.sourceFiles].reverse() },
        inventory,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/source.*order/i)]));
  });

  it("rejects missing authenticated evidence files", async () => {
    expect(typeof storeAssetContract.readAuthenticatedEvidenceFile).toBe(
      "function",
    );
    if (typeof storeAssetContract.readAuthenticatedEvidenceFile !== "function") {
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "ai-limits-evidence-"));
    try {
      await expect(
        storeAssetContract.readAuthenticatedEvidenceFile(
          directory,
          "raw/status-response",
          "a".repeat(64),
        ),
      ).rejects.toThrow(/missing|regular file/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects symlinks in authenticated evidence paths", async () => {
    expect(typeof storeAssetContract.readAuthenticatedEvidenceFile).toBe(
      "function",
    );
    if (typeof storeAssetContract.readAuthenticatedEvidenceFile !== "function") {
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "ai-limits-evidence-"));
    try {
      await writeFile(path.join(directory, "outside"), "trusted", "utf8");
      await symlink("../outside", path.join(directory, "raw"));
      await expect(
        storeAssetContract.readAuthenticatedEvidenceFile(
          directory,
          "raw/status-response",
          "a".repeat(64),
        ),
      ).rejects.toThrow(/symbolic link/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects path escapes in authenticated evidence paths", async () => {
    expect(typeof storeAssetContract.readAuthenticatedEvidenceFile).toBe(
      "function",
    );
    if (typeof storeAssetContract.readAuthenticatedEvidenceFile !== "function") {
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "ai-limits-evidence-"));
    try {
      await expect(
        storeAssetContract.readAuthenticatedEvidenceFile(
          directory,
          "../outside",
          "a".repeat(64),
        ),
      ).rejects.toThrow(/escapes/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects byte changes in authenticated evidence files", async () => {
    expect(typeof storeAssetContract.readAuthenticatedEvidenceFile).toBe(
      "function",
    );
    if (typeof storeAssetContract.readAuthenticatedEvidenceFile !== "function") {
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "ai-limits-evidence-"));
    try {
      await mkdir(path.join(directory, "raw"));
      await writeFile(path.join(directory, "raw", "status-response"), "changed", "utf8");
      await expect(
        storeAssetContract.readAuthenticatedEvidenceFile(
          directory,
          "raw/status-response",
          "a".repeat(64),
        ),
      ).rejects.toThrow(/SHA-256/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts only a complete fixture-only production capture manifest", () => {
    const captures = createFidelityCaptureMatrix().map((capture) => ({
      ...capture,
      path: `${capture.id}.png`,
      sha256: "e".repeat(64),
      dimensions: {
        width: capture.viewport.width,
        height: capture.viewport.height,
      },
      exactScreen: true,
      reducedMotion: true,
      scrollTop: 0,
      keyboardTraversal: {
        focusableCount: 4,
        visitedCount: 4,
        verticalVisibility: true,
        failures: [],
      },
      keyboardRoute: capture.keyboardNavigation.map((step) => ({
        ...step,
        focused: true,
        visible: true,
        replaced: true,
      })),
      focusReturn:
        capture.state === "delete-confirmation"
          ? {
              control: "cancel-delete",
              key: "Space",
              focused: true,
              restoredTarget: ".danger-zone__trigger",
              restored: true,
            }
          : {
                "provider-detail": 'button[aria-label="Open Kimi details"]',
                history:
                  'button[aria-label="Open Kimi history for 5-hour usage"]',
                "add-provider": ".add-provider-action",
                settings: 'button[aria-label="Settings"]',
                "api-key-connect":
                  'button[aria-label="Replace ElevenLabs API key"]',
              }[capture.screen]
            ? {
                control: "back",
                key: "Enter",
                focused: true,
                restoredTarget: {
                  "provider-detail": 'button[aria-label="Open Kimi details"]',
                  history:
                    'button[aria-label="Open Kimi history for 5-hour usage"]',
                  "add-provider": ".add-provider-action",
                  settings: 'button[aria-label="Settings"]',
                  "api-key-connect":
                    'button[aria-label="Replace ElevenLabs API key"]',
                }[capture.screen],
                restored: true,
              }
            : null,
      undersizedTargets: [],
      clippedTargets: [],
      unnamedTargets: [],
      invalidMeters: [],
      brokenImages: [],
      longCopyGeometry:
        capture.viewport.width === 340
          ? { verified: true, targetCount: 4, violations: [] }
          : null,
      compactOverview:
        capture.screen === "overview"
          ? {
              verified: true,
              targetCount: 4,
              statusCount: 5,
              freshStatusCount: 5,
              markCount: 5,
              markGeometryCount: 5,
              narrowMarkAlignmentCount: capture.viewport.width <= 380 ? 5 : 0,
              narrowMarkAlignmentVerified: true,
              quotaCount: 10,
              resetCount: 7,
              untimedCount: 3,
              wideIdentityCount: capture.viewport.width > 380 ? 1 : 0,
              wideIdentityVerified: true,
              violations: [],
            }
          : null,
      apiKeyGuide:
        capture.screen === "api-key-connect"
          ? {
              verified: true,
              inputPopulated: true,
              primaryEnabled: true,
              contrastRatio: 7.02,
              markPath: "/provider-marks/elevenlabs.svg",
              violations: [],
            }
          : null,
    }));
    const valid = {
      schemaVersion: 1,
      dataSource: "fixture",
      fixedClock: FIDELITY_FIXED_CLOCK,
      captures,
    };

    expect(validateFidelityProductionManifest(valid)).toEqual([]);
    expect(
      validateFidelityProductionManifest({
        ...valid,
        dataSource: "live",
        fixedClock: "",
        captures: captures.slice(1).map((capture, index) =>
          index === 0
            ? {
                ...capture,
                sha256: "bad",
                exactScreen: false,
                scrollTop: 200,
                keyboardTraversal: {
                  focusableCount: 4,
                  visitedCount: 1,
                  verticalVisibility: false,
                  failures: ["unnamed focus target"],
                },
                keyboardRoute: [
                  {
                    selector: ".wrong-route",
                    key: "Enter",
                    focused: false,
                    visible: false,
                    replaced: false,
                  },
                ],
                focusReturn: {
                  control: "mouse",
                  key: "Click",
                  focused: false,
                  restoredTarget: ".wrong-route",
                  restored: false,
                },
                undersizedTargets: [{ name: "Bad" }],
              }
            : capture,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fixture/i),
        expect.stringMatching(/fixed clock/i),
        expect.stringMatching(/complete.*matrix/i),
        expect.stringMatching(/SHA-256/i),
        expect.stringMatching(/screen replacement/i),
        expect.stringMatching(/44px/i),
        expect.stringMatching(/scroll position/i),
        expect.stringMatching(/keyboard traversal/i),
        expect.stringMatching(/vertical visibility/i),
        expect.stringMatching(/keyboard route/i),
        expect.stringMatching(/focus return/i),
      ]),
    );

    expect(
      validateFidelityProductionManifest({
        ...valid,
        captures: captures.map((capture, index) =>
          index === 0 ? { ...capture, longCopyGeometry: null } : capture,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/long-copy.*340/i)]),
    );

    expect(
      validateFidelityProductionManifest({
        ...valid,
        captures: captures.map((capture) =>
          capture.screen === "overview"
            ? {
                ...capture,
                compactOverview: {
                  verified: false,
                  targetCount: 4,
                  statusCount: 4,
                  freshStatusCount: 4,
                  markCount: 4,
                  markGeometryCount: 4,
                  narrowMarkAlignmentCount:
                    capture.viewport.width <= 380 ? 4 : 0,
                  narrowMarkAlignmentVerified: true,
                  quotaCount: 6,
                  resetCount: 6,
                  wideIdentityCount: capture.viewport.width > 380 ? 1 : 0,
                  wideIdentityVerified: true,
                  violations: ["painted control is 44px tall"],
                },
              }
            : capture,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/compact overview/i)]),
    );

    expect(
      validateFidelityProductionManifest({
        ...valid,
        captures: captures.map((capture) =>
          capture.screen === "api-key-connect"
            ? {
                ...capture,
                apiKeyGuide: {
                  verified: false,
                  inputPopulated: true,
                  primaryEnabled: true,
                  contrastRatio: 2.72,
                  markPath: "/provider-marks/elevenlabs.svg",
                  violations: ["primary action contrast is 2.72:1"],
                },
              }
            : capture,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/API-key setup/i)]),
    );

    for (const compactOverview of [
      {
        verified: true,
        targetCount: 4,
        statusCount: 3,
        freshStatusCount: 3,
        markCount: 4,
        markGeometryCount: 4,
        narrowMarkAlignmentCount: 0,
        narrowMarkAlignmentVerified: true,
        quotaCount: 6,
        resetCount: 6,
        wideIdentityCount: 1,
        wideIdentityVerified: true,
        violations: [],
      },
      {
        verified: true,
        targetCount: 4,
        statusCount: 4,
        freshStatusCount: 3,
        markCount: 4,
        markGeometryCount: 4,
        narrowMarkAlignmentCount: 0,
        narrowMarkAlignmentVerified: true,
        quotaCount: 6,
        resetCount: 6,
        wideIdentityCount: 1,
        wideIdentityVerified: true,
        violations: [],
      },
      {
        verified: true,
        targetCount: 4,
        statusCount: 4,
        freshStatusCount: 4,
        markCount: 4,
        markGeometryCount: 3,
        narrowMarkAlignmentCount: 0,
        narrowMarkAlignmentVerified: true,
        quotaCount: 6,
        resetCount: 6,
        wideIdentityCount: 1,
        wideIdentityVerified: true,
        violations: [],
      },
      {
        verified: true,
        targetCount: 4,
        statusCount: 4,
        freshStatusCount: 4,
        markCount: 4,
        markGeometryCount: 4,
        narrowMarkAlignmentCount: 0,
        narrowMarkAlignmentVerified: true,
        quotaCount: 6,
        resetCount: 5,
        wideIdentityCount: 1,
        wideIdentityVerified: true,
        violations: [],
      },
      {
        verified: true,
        targetCount: 4,
        statusCount: 4,
        freshStatusCount: 4,
        markCount: 4,
        markGeometryCount: 4,
        narrowMarkAlignmentCount: 0,
        narrowMarkAlignmentVerified: true,
        quotaCount: 6,
        resetCount: 6,
        wideIdentityCount: 0,
        wideIdentityVerified: false,
        violations: [],
      },
      {
        verified: true,
        targetCount: 4,
        statusCount: 4,
        freshStatusCount: 4,
        markCount: 4,
        markGeometryCount: 4,
        narrowMarkAlignmentCount: 3,
        narrowMarkAlignmentVerified: false,
        quotaCount: 6,
        resetCount: 6,
        wideIdentityCount: 0,
        wideIdentityVerified: true,
        violations: [],
      },
    ]) {
      expect(
        validateFidelityProductionManifest({
          ...valid,
          captures: captures.map((capture) =>
            capture.screen === "overview"
              ? { ...capture, compactOverview }
              : capture,
          ),
        }),
      ).toEqual(
        expect.arrayContaining([expect.stringMatching(/compact overview/i)]),
      );
    }
  });

  it("reads dimensions from a fully encoded PNG", () => {
    expect(readPngDimensions(encodedPng(1280, 800))).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("rejects malformed, truncated, CRC-corrupt, and missing-IEND PNGs", () => {
    const valid = encodedPng(1280, 800);
    const badCrc = Buffer.from(valid);
    badCrc[16] ^= 1;

    expect(() => readPngDimensions(Buffer.from("not a PNG"))).toThrow();
    expect(() => readPngDimensions(valid.subarray(0, 33))).toThrow();
    expect(() => readPngDimensions(badCrc)).toThrow();
    expect(() => readPngDimensions(valid.subarray(0, -12))).toThrow();
  });

  it("rejects a wrong screenshot size", () => {
    const errors = validateStoreAssetDimensions({
      "chrome-web-store/screenshot-overview-1280x800.png": {
        width: 640,
        height: 400,
      },
    });
    expect(errors).toContain(
      "chrome-web-store/screenshot-overview-1280x800.png must be 1280x800.",
    );
  });

  it("requires a 1280x640 GitHub social preview below one megabyte", () => {
    const dimensions = { width: 1280, height: 800 };
    const errors = validateStoreAssetDimensions({
      "chrome-web-store/screenshot-overview-1280x800.png": dimensions,
      "chrome-web-store/screenshot-pacing-1280x800.png": dimensions,
      "chrome-web-store/screenshot-history-1280x800.png": dimensions,
      "chrome-web-store/screenshot-privacy-1280x800.png": dimensions,
      "chrome-web-store/small-promo-440x280.png": { width: 440, height: 280 },
      "chrome-web-store/zh_CN/screenshot-overview-1280x800.png": dimensions,
      "chrome-web-store/zh_CN/screenshot-pacing-1280x800.png": dimensions,
      "chrome-web-store/zh_CN/screenshot-history-1280x800.png": dimensions,
      "chrome-web-store/zh_CN/screenshot-privacy-1280x800.png": dimensions,
      "github/social-preview-1280x640.png": { width: 1280, height: 641 },
    });

    expect(errors).toContain(
      "github/social-preview-1280x640.png must be 1280x640.",
    );
    expect(
      storeAssetContract.validateMarketingAssetFileSizes({
        "github/social-preview-1280x640.png": 1_000_001,
      }),
    ).toContain(
      "github/social-preview-1280x640.png must be smaller than 1000000 bytes.",
    );
  });

  it("requires four Simplified Chinese screenshots without localizing the promo tile", () => {
    const dimensions = { width: 1280, height: 800 };
    const errors = validateStoreAssetDimensions({
      "chrome-web-store/screenshot-overview-1280x800.png": dimensions,
      "chrome-web-store/screenshot-pacing-1280x800.png": dimensions,
      "chrome-web-store/screenshot-history-1280x800.png": dimensions,
      "chrome-web-store/screenshot-privacy-1280x800.png": dimensions,
      "chrome-web-store/small-promo-440x280.png": { width: 440, height: 280 },
      "github/social-preview-1280x640.png": { width: 1280, height: 640 },
    });

    expect(errors).toEqual([
      "chrome-web-store/zh_CN/screenshot-overview-1280x800.png is missing.",
      "chrome-web-store/zh_CN/screenshot-pacing-1280x800.png is missing.",
      "chrome-web-store/zh_CN/screenshot-history-1280x800.png is missing.",
      "chrome-web-store/zh_CN/screenshot-privacy-1280x800.png is missing.",
    ]);
    expect(errors).not.toContain(
      "chrome-web-store/zh_CN/small-promo-440x280.png is missing.",
    );
  });
});
