import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { PNG } from "pngjs";

export const FIDELITY_ARTIFACT_ID =
  "90076f25-e8be-4bce-9b9e-77af020bc08d";
export const FIDELITY_FILES_RESPONSE_SHA256 =
  "42925a3b19f15c62ca2b917cd76ec2095e40dca7dce975c4d4ea589cc9f4e537";
export const FIDELITY_RESPONSE_SHA256 = Object.freeze({
  "status-response":
    "eae5108294cdf028b7c78685ae7f4dc72c30fbaf78d36ae5b1d02fb95ae27cba",
  "artifact-response":
    "25293caa928986da87fc38caf17bb037b9d9ff893e53686ae976976b0f1ea648",
  "history-response":
    "ec2faab8338c8e97748bc64128fcbb66f1414ddfd989970620936e5cbd898eec",
  "files-response": FIDELITY_FILES_RESPONSE_SHA256,
});
export const FIDELITY_FIXED_CLOCK = "2026-08-09T14:00:00.000Z";
export const FIDELITY_MISSING_SOURCE_FILES = [
  "index.tsx",
  "package.json",
  "tailwind.config.js",
  "components/StatusChip.tsx",
  "components/IllustrativeNote.tsx",
  "components/SurfaceTradeoffs.tsx",
  "components/GithubConcepts.tsx",
];
export const FIDELITY_UNRESOLVED_IMPORTS = [
  { importer: "components/ProviderCard.tsx", specifier: "./StatusChip" },
  {
    importer: "pages/ProviderDetail.tsx",
    specifier: "../components/IllustrativeNote",
  },
  {
    importer: "pages/ProviderDetail.tsx",
    specifier: "../components/StatusChip",
  },
  {
    importer: "pages/History.tsx",
    specifier: "../components/IllustrativeNote",
  },
  {
    importer: "pages/AddProvider.tsx",
    specifier: "../components/IllustrativeNote",
  },
  {
    importer: "pages/Settings.tsx",
    specifier: "../components/IllustrativeNote",
  },
  {
    importer: "components/PanelFrame.tsx",
    specifier: "./SurfaceTradeoffs",
  },
  {
    importer: "components/PanelFrame.tsx",
    specifier: "./GithubConcepts",
  },
  {
    importer: "pages/FirstRun.tsx",
    specifier: "../components/IllustrativeNote",
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function captureMatchesSha256(buffer, expectedSha256) {
  return sha256(buffer) === expectedSha256;
}

export function resolveContainedCapturePath(directory, relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Capture path escapes its evidence directory.");
  }
  const resolvedDirectory = path.resolve(directory);
  const resolvedPath = path.resolve(resolvedDirectory, relativePath);
  const relative = path.relative(resolvedDirectory, resolvedPath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Capture path escapes its evidence directory.");
  }
  return resolvedPath;
}

export async function readAuthenticatedEvidenceFile(
  directory,
  relativePath,
  expectedSha256,
) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedPath = resolveContainedCapturePath(
    resolvedDirectory,
    relativePath,
  );
  const relative = path.relative(resolvedDirectory, resolvedPath);
  let current = resolvedDirectory;

  try {
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Authenticated evidence path contains a symbolic link: ${relativePath}`,
        );
      }
    }
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw new Error(`Authenticated evidence file is missing: ${relativePath}`);
    }
    throw error;
  }

  const finalStat = await lstat(resolvedPath);
  if (!finalStat.isFile()) {
    throw new Error(
      `Authenticated evidence path is not a regular file: ${relativePath}`,
    );
  }
  const bytes = await readFile(resolvedPath);
  if (!SHA256.test(expectedSha256 ?? "") || sha256(bytes) !== expectedSha256) {
    throw new Error(
      `Authenticated evidence SHA-256 changed for ${relativePath}.`,
    );
  }
  return bytes;
}

export function resolveFidelitySnapshotDirectory({ argv = [], env = {} } = {}) {
  const flagName = "--snapshot-dir";
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === flagName) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flagName} requires a value.`);
      }
      values.push(value);
      index += 1;
    } else if (argument.startsWith(`${flagName}=`)) {
      const value = argument.slice(`${flagName}=`.length);
      if (!value) {
        throw new Error(`${flagName} requires a value.`);
      }
      values.push(value);
    }
  }

  if (values.length > 1) {
    throw new Error(`${flagName} may be provided only once.`);
  }

  const cliValue = values[0]?.trim();
  const environmentValue = env.AI_LIMITS_FIDELITY_SNAPSHOT_DIR?.trim();
  if (
    cliValue &&
    environmentValue &&
    path.resolve(cliValue) !== path.resolve(environmentValue)
  ) {
    throw new Error(
      `Conflicting fidelity snapshot directories were supplied by ${flagName} and AI_LIMITS_FIDELITY_SNAPSHOT_DIR.`,
    );
  }

  const supplied = cliValue || environmentValue;
  if (!supplied) {
    throw new Error(
      `Provide the saved MCP response directory with ${flagName} or AI_LIMITS_FIDELITY_SNAPSHOT_DIR.`,
    );
  }
  if (!path.isAbsolute(supplied)) {
    throw new Error("The fidelity snapshot directory must be an absolute path.");
  }

  const resolved = path.resolve(supplied);
  if (resolved === path.parse(resolved).root) {
    throw new Error("The fidelity snapshot directory cannot be a filesystem root.");
  }
  return resolved;
}

export function pacingCardScrollTop({
  cardOffsetTop,
  stickyHeight,
  scrollHeight,
  clientHeight,
}) {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return Math.min(
    maximum,
    Math.max(0, cardOffsetTop - Math.max(0, stickyHeight) - 8),
  );
}

export function extractCssCustomProperties(css) {
  const entries = [];
  for (const block of css.matchAll(/\{([^{}]*)\}/gsu)) {
    for (const declaration of block[1].matchAll(
      /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/giu,
    )) {
      entries.push([declaration[1], declaration[2].trim()]);
    }
  }
  return Object.fromEntries(entries);
}

function staticClassTokens(sourceFiles) {
  const tokens = new Set();
  const classPattern = /className=(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/gu;
  for (const sourceFile of sourceFiles) {
    for (const match of sourceFile.content.matchAll(classPattern)) {
      const classes = match[1] ?? match[2] ?? match[3] ?? "";
      for (const token of classes.split(/\s+/u)) {
        if (token && !token.includes("${")) {
          tokens.add(token);
        }
      }
    }
  }
  return [...tokens].sort();
}

export function fidelityHarnessPatch() {
  return `diff --git a/fidelity-harness/index.tsx b/fidelity-harness/index.tsx
new file mode 100644
--- /dev/null
+++ b/fidelity-harness/index.tsx
@@ -0,0 +1,12 @@
+import React from 'react'
+import { createRoot } from 'react-dom/client'
+import { App } from '../App'
+import '../index.css'
+
+export const FIDELITY_FIXED_CLOCK = '${FIDELITY_FIXED_CLOCK}'
+
+const root = document.getElementById('root')
+if (!root) throw new Error('Missing fidelity harness root')
+
+createRoot(root).render(<App />)
+
`;
}

export async function buildFidelitySourceComparison(inventory, repositoryRoot) {
  const productionCssPath = path.join(
    repositoryRoot,
    "entrypoints",
    "sidepanel",
    "styles.css",
  );
  const productionCss = await readFile(productionCssPath, "utf8");
  const componentMappings = [
    {
      screen: "first-run",
      artifact: ["pages/FirstRun.tsx"],
      production: ["entrypoints/sidepanel/views/FirstRunView.tsx"],
    },
    {
      screen: "overview",
      artifact: ["pages/Overview.tsx", "components/AppHeader.tsx"],
      production: [
        "entrypoints/sidepanel/views/OverviewView.tsx",
        "entrypoints/sidepanel/components/AppHeader.tsx",
      ],
    },
    {
      screen: "provider-detail",
      artifact: ["pages/ProviderDetail.tsx"],
      production: ["entrypoints/sidepanel/views/ProviderDetailView.tsx"],
    },
    {
      screen: "history",
      artifact: ["pages/History.tsx", "components/HistoryChart.tsx"],
      production: [
        "entrypoints/sidepanel/views/HistoryView.tsx",
        "entrypoints/sidepanel/components/HistoryChart.tsx",
      ],
    },
    {
      screen: "add-provider",
      artifact: ["pages/AddProvider.tsx"],
      production: ["entrypoints/sidepanel/views/AddProviderView.tsx"],
    },
    {
      screen: "settings",
      artifact: ["pages/Settings.tsx"],
      production: ["entrypoints/sidepanel/views/SettingsView.tsx"],
    },
  ];

  for (const mapping of componentMappings) {
    mapping.artifactSources = mapping.artifact.map((sourcePath) => ({
      path: sourcePath,
      sha256:
        inventory.sourceFiles.find((source) => source.path === sourcePath)
          ?.sha256 ?? null,
      available: inventory.sourceFiles.some(
        (source) => source.path === sourcePath,
      ),
    }));
    mapping.productionSources = await Promise.all(
      mapping.production.map(async (sourcePath) => {
        const content = await readFile(path.join(repositoryRoot, sourcePath));
        return { path: sourcePath, sha256: sha256(content) };
      }),
    );
  }

  return {
    artifactId: inventory.artifactId,
    comparisonAuthority: "source-and-token-only",
    pixelAuthority: false,
    reason:
      "The pinned MCP export omits imported source and exact dependency/configuration files, so no generated reference image is pixel-authoritative.",
    artifactStaticClassTokens: staticClassTokens(inventory.sourceFiles),
    artifactIndexCssSha256:
      inventory.sourceFiles.find((source) => source.path === "index.css")
        ?.sha256 ?? null,
    productionCss: {
      path: "entrypoints/sidepanel/styles.css",
      sha256: sha256(Buffer.from(productionCss, "utf8")),
      customProperties: extractCssCustomProperties(productionCss),
    },
    componentMappings,
  };
}

export function parseMcpSseResponse(response) {
  const dataLines = response
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  if (dataLines.length === 0) {
    throw new Error("Saved MCP response does not contain an SSE data event.");
  }

  const envelope = JSON.parse(dataLines.join("\n"));
  const text = envelope?.result?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  if (!text) {
    throw new Error("Saved MCP response does not contain text content.");
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function artifactFileNames(artifactText) {
  return artifactText
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function artifactIdFromText(artifactText) {
  return artifactText.match(/Artifact ID:\s*([a-f0-9-]+)/iu)?.[1];
}

function importedSpecifiers(content) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\s*)["']([^"']+)["']/gu;
  for (const match of content.matchAll(pattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function externalPackage(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function relativeImportExists(importer, specifier, sourcePaths) {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ].some((candidate) => sourcePaths.has(candidate));
}

export function buildPinnedReferenceInventory({
  statusResponse,
  artifactResponse,
  filesResponse,
  historyResponse,
}) {
  const status = parseMcpSseResponse(statusResponse);
  const artifact = parseMcpSseResponse(artifactResponse);
  const files = parseMcpSseResponse(filesResponse);
  const history = parseMcpSseResponse(historyResponse);
  if (typeof artifact !== "string") {
    throw new Error("Saved artifact response must contain the artifact listing.");
  }

  const artifactId = status.activeArtifactId;
  const listedArtifactId = artifactIdFromText(artifact);
  if (!artifactId || listedArtifactId !== artifactId) {
    throw new Error("Saved MCP responses disagree on the active artifact ID.");
  }

  const advertisedFiles = Array.from(
    new Set([
      ...(status.availableFiles ?? []),
      ...artifactFileNames(artifact),
    ]),
  );
  const sourceFiles = (files.files ?? []).map((file) => ({
    path: file.name,
    content: file.content,
    sha256: sha256(Buffer.from(file.content, "utf8")),
  }));
  const sourcePaths = new Set(sourceFiles.map((file) => file.path));
  const missingSourceFiles = advertisedFiles.filter(
    (file) => !sourcePaths.has(file),
  );
  const unresolvedImports = [];
  const dependencies = new Set();

  for (const sourceFile of sourceFiles) {
    for (const specifier of importedSpecifiers(sourceFile.content)) {
      if (specifier.startsWith(".")) {
        if (!relativeImportExists(sourceFile.path, specifier, sourcePaths)) {
          unresolvedImports.push({ importer: sourceFile.path, specifier });
        }
      } else {
        dependencies.add(externalPackage(specifier));
      }
    }
  }

  return {
    artifactId,
    advertisedFiles,
    sourceFiles,
    missingSourceFiles,
    unresolvedImports,
    externalDependencies: [...dependencies].sort(),
    filesResponseSha256: sha256(Buffer.from(filesResponse, "utf8")),
    historyHasArtifactId: historyResponse.includes(artifactId),
    historyHasMore: history?.hasMore === true,
    referenceRenderable:
      missingSourceFiles.length === 0 && unresolvedImports.length === 0,
  };
}

export const STORE_ASSET_CAPTURES = [
  {
    locale: "en",
    view: "overview",
    relativePath: "screenshot-overview-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    locale: "en",
    view: "pacing",
    relativePath: "screenshot-pacing-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    locale: "en",
    view: "history",
    relativePath: "screenshot-history-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    locale: "en",
    view: "privacy",
    relativePath: "screenshot-privacy-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    locale: "en",
    view: "promo",
    relativePath: "small-promo-440x280.png",
    viewport: { width: 440, height: 280 },
  },
  ...["overview", "pacing", "history", "privacy"].map((view) => ({
    locale: "zh_CN",
    view,
    relativePath: `zh_CN/screenshot-${view}-1280x800.png`,
    viewport: { width: 1280, height: 800 },
  })),
].map((capture) => ({
  ...capture,
  dataSource: "fixture",
  fixedClock: FIDELITY_FIXED_CLOCK,
}));

export const MARKETING_ASSET_CAPTURES = [
  ...STORE_ASSET_CAPTURES.map((capture) => ({
    ...capture,
    relativePath: `chrome-web-store/${capture.relativePath}`,
  })),
  {
    locale: "en",
    view: "social",
    relativePath: "github/social-preview-1280x640.png",
    viewport: { width: 1280, height: 640 },
    dataSource: "fixture",
    fixedClock: FIDELITY_FIXED_CLOCK,
  },
];

export function marketingProviderHeadingSelector(instanceId) {
  const identitySuffix = instanceId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `#provider-name-${identitySuffix}`;
}

export function marketingQuotaHistorySelector(instanceId, metricId) {
  const focusKey = `provider-history-${instanceId}-${metricId}`
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `[data-focus-key="${focusKey}"]`;
}

export function marketingPrivacyRequiredLabels() {
  return ["Demo relay A", "Demo relay B"];
}

const FIDELITY_WIDTHS = [340, 400, 460];
const FIDELITY_THEMES = ["light", "dark"];
const FIDELITY_SCENARIOS = [
  { screen: "first-run", state: "default", mode: "used" },
  { screen: "overview", state: "default", mode: "used" },
  { screen: "provider-detail", state: "default", mode: "used" },
  { screen: "history", state: "default", mode: "used" },
  { screen: "add-provider", state: "default", mode: "used" },
  { screen: "settings", state: "default", mode: "used" },
  { screen: "api-key-connect", state: "default", mode: "used" },
  { screen: "overview", state: "default", mode: "left" },
  { screen: "overview", state: "refresh-pending", mode: "used" },
  { screen: "overview", state: "partial-refresh", mode: "used" },
  {
    screen: "provider-detail",
    state: "kimi-interaction",
    mode: "used",
  },
  { screen: "settings", state: "delete-confirmation", mode: "used" },
];

function keyboardNavigationFor({ screen, state }) {
  const routes = {
    "first-run": [],
    overview: [],
    "provider-detail": [
      {
        selector: 'button[aria-label="Open Kimi details"]',
        readySelector: '[aria-label="Kimi detail"]',
        key: "Enter",
      },
    ],
    history: [
      {
        selector: 'button[aria-label="Open Kimi history for 5-hour usage"]',
        readySelector: '[aria-label="Kimi history"]',
        key: "Space",
      },
    ],
    "add-provider": [
      {
        selector: ".add-provider-action",
        readySelector: '[aria-label="Add provider"]',
        key: "Enter",
      },
    ],
    settings: [
      {
        selector: 'button[aria-label="Settings"]',
        readySelector: '[aria-label="Provider settings"]',
        key: "Space",
      },
    ],
    "api-key-connect": [
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
    ],
  };
  const steps = routes[screen].map((step) => ({ ...step }));
  if (state === "delete-confirmation") {
    steps.push({
      selector: ".danger-zone__trigger",
      readySelector: '[aria-label="Confirm local data deletion"]',
      key: "Enter",
    });
  }
  return steps;
}

export function createFidelityCaptureMatrix() {
  return FIDELITY_WIDTHS.flatMap((width) =>
    FIDELITY_THEMES.flatMap((theme) =>
      FIDELITY_SCENARIOS.map((scenario) => ({
        id: `${scenario.screen}-${scenario.state}-${scenario.mode}-${width}-${theme}`,
        ...scenario,
        keyboardNavigation: keyboardNavigationFor(scenario),
        theme,
        viewport: { width, height: 900 },
        fixedClock: FIDELITY_FIXED_CLOCK,
        dataSource: "fixture",
        locale: "en-US",
      })),
    ),
  );
}

export function fidelityScreenHasModeControl(screen) {
  return screen === "overview" || screen === "history";
}

export function buildFidelityPreviewQuery(capture) {
  return new URLSearchParams({
    fidelity: "1",
    screen: capture.screen,
    state: capture.state,
    mode: capture.mode,
    theme: capture.theme,
    panelWidth: String(capture.viewport.width),
    dataSource: capture.dataSource,
    fixedClock: capture.fixedClock,
    locale: capture.locale,
  }).toString();
}

const SHA256 = /^[a-f0-9]{64}$/u;
const FIDELITY_SCREENS = new Set([
  "first-run",
  "overview",
  "provider-detail",
  "history",
  "add-provider",
  "settings",
  "api-key-connect",
]);
const FIDELITY_STATES = new Set([
  "default",
  "refresh-pending",
  "partial-refresh",
  "kimi-interaction",
  "delete-confirmation",
]);

export function validateFidelityReferenceManifest(manifest) {
  const errors = [];

  if (manifest?.artifactId !== FIDELITY_ARTIFACT_ID) {
    errors.push(`Reference manifest must use artifact ID ${FIDELITY_ARTIFACT_ID}.`);
  }
  if (manifest?.filesResponse?.sha256 !== FIDELITY_FILES_RESPONSE_SHA256) {
    errors.push(
      `Reference manifest files response must have SHA-256 ${FIDELITY_FILES_RESPONSE_SHA256}.`,
    );
  }
  if (
    typeof manifest?.filesResponse?.path !== "string" ||
    path.isAbsolute(manifest.filesResponse.path) ||
    manifest.filesResponse.path !== "raw/files-response"
  ) {
    errors.push("Reference response files must use their confined relative path.");
  }
  const responseEntries = Object.entries(FIDELITY_RESPONSE_SHA256);
  const responseFiles = Array.isArray(manifest?.responseFiles)
    ? manifest.responseFiles
    : [];
  if (
    responseFiles.length !== responseEntries.length ||
    responseEntries.some(([name, expectedHash], index) => {
      const response = responseFiles[index];
      return (
        response?.name !== name ||
        response?.path !== `raw/${name}` ||
        response?.sha256 !== expectedHash
      );
    })
  ) {
    errors.push(
      "Reference manifest must bind every raw response to its pinned hash and relative path in order.",
    );
  }
  if (manifest?.referenceRenderable !== false) {
    errors.push("The pinned reference snapshot must remain non-renderable.");
  }
  if (manifest?.referenceStatus !== "blocked") {
    errors.push("The pinned reference status must remain blocked.");
  }
  if (
    !Array.isArray(manifest?.missingSourceFiles) ||
    manifest.missingSourceFiles.length !== FIDELITY_MISSING_SOURCE_FILES.length ||
    FIDELITY_MISSING_SOURCE_FILES.some(
      (sourcePath) => !manifest.missingSourceFiles.includes(sourcePath),
    )
  ) {
    errors.push("The pinned reference must record the exact missing source files.");
  }
  const unresolvedImports = Array.isArray(manifest?.unresolvedImports)
    ? manifest.unresolvedImports
    : [];
  const unresolvedImportKeys = new Set(
    unresolvedImports.map(
      (entry) => `${entry?.importer}\0${entry?.specifier}`,
    ),
  );
  if (
    unresolvedImports.length !== FIDELITY_UNRESOLVED_IMPORTS.length ||
    FIDELITY_UNRESOLVED_IMPORTS.some(
      ({ importer, specifier }) =>
        !unresolvedImportKeys.has(`${importer}\0${specifier}`),
    )
  ) {
    errors.push("The pinned reference must record the exact unresolved imports.");
  }
  if (!Array.isArray(manifest?.sourceFiles) || manifest.sourceFiles.length === 0) {
    errors.push("Reference manifest must include source file hashes.");
  } else {
    for (const sourceFile of manifest.sourceFiles) {
      if (!sourceFile?.path || !SHA256.test(sourceFile?.sha256 ?? "")) {
        errors.push("Every reference source file must have a path and SHA-256 hash.");
      }
    }
  }
  if (
    !manifest?.harnessPatch?.path ||
    path.isAbsolute(manifest.harnessPatch.path) ||
    manifest.harnessPatch.path !== "harness.patch" ||
    !SHA256.test(manifest?.harnessPatch?.sha256 ?? "")
  ) {
    errors.push("Reference manifest must include the ignored harness patch hash.");
  }
  if (
    !manifest?.sourceComparison?.path ||
    path.isAbsolute(manifest.sourceComparison.path) ||
    manifest.sourceComparison.path !== "source-comparison.json" ||
    !SHA256.test(manifest?.sourceComparison?.sha256 ?? "")
  ) {
    errors.push("Reference manifest must include the source comparison evidence hash.");
  }
  if (!Array.isArray(manifest?.captures) || manifest.captures.length === 0) {
    errors.push("Reference manifest must include artifact captures.");
  } else {
    const expectedCaptures = createFidelityCaptureMatrix();
    if (
      manifest.captures.length !== expectedCaptures.length ||
      new Set(manifest.captures.map((capture) => capture.id)).size !==
        expectedCaptures.length ||
      expectedCaptures.some(
        (expected) =>
          !manifest.captures.some((capture) => capture.id === expected.id),
      )
    ) {
      errors.push("Reference manifest must contain the complete capture matrix.");
    }
    const orderChanged = expectedCaptures.some(
      (expected, index) => manifest.captures[index]?.id !== expected.id,
    );
    if (orderChanged) {
      errors.push("Reference capture order must match the approved matrix.");
    }
    for (const [index, capture] of manifest.captures.entries()) {
      const expected = expectedCaptures[index];
      if (
        !capture?.viewport ||
        !FIDELITY_WIDTHS.includes(capture.viewport.width) ||
        !Number.isFinite(capture.viewport.height)
      ) {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing a valid viewport.`);
      }
      if (!FIDELITY_THEMES.includes(capture?.theme)) {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing a valid theme.`);
      }
      if (!FIDELITY_SCREENS.has(capture?.screen)) {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing a valid screen.`);
      }
      if (!FIDELITY_STATES.has(capture?.state)) {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing a valid state.`);
      }
      if (capture?.fixedClock !== FIDELITY_FIXED_CLOCK) {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing the fixed clock.`);
      }
      if (capture?.dataSource !== "fixture") {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing the fixture data source.`);
      }
      if (capture?.locale !== "en-US") {
        errors.push(`${capture?.id ?? "Artifact capture"} is missing the pinned locale.`);
      }
      if (capture?.status !== "blocked-missing-source") {
        errors.push(
          `${capture?.id ?? "Artifact capture"} must remain blocked-missing-source.`,
        );
      }
      if (
        capture?.path !== undefined ||
        capture?.sha256 !== undefined ||
        capture?.dimensions !== undefined
      ) {
        errors.push(
          `${capture?.id ?? "Artifact capture"} must not include an image path, hash, or dimensions.`,
        );
      }
      if (
        expected &&
        JSON.stringify(capture) !==
          JSON.stringify({ ...expected, status: "blocked-missing-source" })
      ) {
        errors.push(
          `${capture?.id ?? "Artifact capture"} does not exactly match its approved capture fields.`,
        );
      }
    }
  }

  return errors;
}

export function validatePinnedReferenceInventory(manifest, inventory) {
  const errors = [];
  const exactStringList = (actual, expected, label) => {
    if (
      !Array.isArray(actual) ||
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) {
      errors.push(`Pinned ${label} order or values changed.`);
    }
  };

  exactStringList(
    manifest?.advertisedFiles,
    inventory.advertisedFiles,
    "advertised file",
  );
  exactStringList(
    manifest?.missingSourceFiles,
    inventory.missingSourceFiles,
    "missing source file",
  );

  const actualSources = Array.isArray(manifest?.sourceFiles)
    ? manifest.sourceFiles
    : [];
  if (actualSources.length !== inventory.sourceFiles.length) {
    errors.push("Pinned source inventory length changed.");
  }
  for (const [index, expected] of inventory.sourceFiles.entries()) {
    const actual = actualSources[index];
    if (actual?.path !== expected.path) {
      errors.push("Pinned source file order changed.");
      continue;
    }
    if (actual.sha256 !== expected.sha256) {
      errors.push(`Pinned source hash changed for ${expected.path}.`);
    }
    if (actual.bytes !== Buffer.byteLength(expected.content, "utf8")) {
      errors.push(`Pinned source byte length changed for ${expected.path}.`);
    }
  }

  const actualImports = Array.isArray(manifest?.unresolvedImports)
    ? manifest.unresolvedImports
    : [];
  if (
    JSON.stringify(actualImports) !== JSON.stringify(inventory.unresolvedImports)
  ) {
    errors.push("Pinned unresolved import order or values changed.");
  }
  return errors;
}

export function validateFidelityProductionManifest(manifest) {
  const errors = [];
  const expected = createFidelityCaptureMatrix();
  const expectedById = new Map(expected.map((capture) => [capture.id, capture]));
  const captures = Array.isArray(manifest?.captures) ? manifest.captures : [];

  if (manifest?.dataSource !== "fixture") {
    errors.push("Production fidelity captures must use fixture data only.");
  }
  if (manifest?.fixedClock !== FIDELITY_FIXED_CLOCK) {
    errors.push("Production fidelity captures must use the explicit fixed clock.");
  }
  if (
    captures.length !== expected.length ||
    new Set(captures.map((capture) => capture.id)).size !== expected.length ||
    expected.some(
      (capture) => !captures.some((candidate) => candidate.id === capture.id),
    )
  ) {
    errors.push("Production fidelity manifest must contain the complete capture matrix.");
  }

  for (const capture of captures) {
    const contract = expectedById.get(capture.id);
    if (!contract) {
      errors.push(`${capture.id ?? "Capture"} is not part of the approved matrix.`);
      continue;
    }
    for (const field of [
      "screen",
      "state",
      "mode",
      "theme",
      "fixedClock",
      "dataSource",
      "locale",
    ]) {
      if (capture[field] !== contract[field]) {
        errors.push(`${capture.id} has the wrong ${field}.`);
      }
    }
    if (
      capture?.viewport?.width !== contract.viewport.width ||
      capture?.viewport?.height !== contract.viewport.height ||
      capture?.dimensions?.width !== contract.viewport.width ||
      capture?.dimensions?.height < contract.viewport.height
    ) {
      errors.push(`${capture.id} has invalid viewport or PNG dimensions.`);
    }
    if (!capture.path || !SHA256.test(capture.sha256 ?? "")) {
      errors.push(`${capture.id} is missing its path or SHA-256.`);
    }
    if (capture.exactScreen !== true) {
      errors.push(`${capture.id} failed exact screen replacement.`);
    }
    if (capture.reducedMotion !== true) {
      errors.push(`${capture.id} did not verify reduced motion.`);
    }
    if (capture.scrollTop !== 0) {
      errors.push(`${capture.id} did not reset the capture scroll position.`);
    }
    const traversal = capture.keyboardTraversal;
    if (
      !Number.isInteger(traversal?.focusableCount) ||
      traversal.focusableCount < 1 ||
      traversal.visitedCount !== traversal.focusableCount ||
      (traversal.failures ?? []).length > 0
    ) {
      errors.push(`${capture.id} failed complete keyboard traversal.`);
    }
    const keyboardRoute = Array.isArray(capture.keyboardRoute)
      ? capture.keyboardRoute
      : [];
    if (
      traversal?.verticalVisibility !== true ||
      keyboardRoute.some((result) => result?.visible !== true)
    ) {
      errors.push(`${capture.id} failed keyboard vertical visibility checks.`);
    }
    if (
      keyboardRoute.length !== contract.keyboardNavigation.length ||
      contract.keyboardNavigation.some((step, index) => {
        const result = keyboardRoute[index];
        return (
          result?.selector !== step.selector ||
          result?.readySelector !== step.readySelector ||
          result?.key !== step.key ||
          result?.focused !== true ||
          result?.visible !== true ||
          result?.replaced !== true
        );
      })
    ) {
      errors.push(`${capture.id} failed its keyboard route acceptance.`);
    }
    const restoredTarget = {
      "provider-detail": 'button[aria-label="Open Kimi details"]',
      history: 'button[aria-label="Open Kimi history for 5-hour usage"]',
      "add-provider": ".add-provider-action",
      settings: 'button[aria-label="Settings"]',
      "api-key-connect":
        'button[aria-label="Replace ElevenLabs API key"]',
    }[capture.screen];
    const expectedFocusReturn =
      capture.state === "delete-confirmation"
        ? {
            control: "cancel-delete",
            key: "Space",
            restoredTarget: ".danger-zone__trigger",
          }
        : restoredTarget
          ? { control: "back", key: "Enter", restoredTarget }
          : null;
    if (
      expectedFocusReturn === null
        ? capture.focusReturn !== null
        : capture.focusReturn?.control !== expectedFocusReturn.control ||
          capture.focusReturn?.key !== expectedFocusReturn.key ||
          capture.focusReturn?.restoredTarget !==
            expectedFocusReturn.restoredTarget ||
          capture.focusReturn?.focused !== true ||
          capture.focusReturn?.restored !== true
    ) {
      errors.push(`${capture.id} failed its keyboard focus return acceptance.`);
    }
    if ((capture.undersizedTargets ?? []).length > 0) {
      errors.push(`${capture.id} has a target below 44px.`);
    }
    for (const [field, label] of [
      ["clippedTargets", "clipped controls"],
      ["unnamedTargets", "unnamed controls"],
      ["invalidMeters", "invalid meters"],
      ["brokenImages", "broken images"],
    ]) {
      if ((capture[field] ?? []).length > 0) {
        errors.push(`${capture.id} has ${label}.`);
      }
    }
    if (
      contract.viewport.width === 340 &&
      (capture.longCopyGeometry?.verified !== true ||
        !Number.isInteger(capture.longCopyGeometry?.targetCount) ||
        capture.longCopyGeometry.targetCount < 1 ||
        (capture.longCopyGeometry?.violations ?? []).length > 0)
    ) {
      errors.push(`${capture.id} failed the long-copy 340px geometry scenario.`);
    }
    if (
      contract.screen === "overview" &&
      (capture.compactOverview?.verified !== true ||
        capture.compactOverview?.targetCount !== 4 ||
        capture.compactOverview?.statusCount !== 5 ||
        capture.compactOverview?.freshStatusCount !== 5 ||
        capture.compactOverview?.markCount !== 5 ||
        capture.compactOverview?.markGeometryCount !== 5 ||
        capture.compactOverview?.narrowMarkAlignmentVerified !== true ||
        capture.compactOverview?.narrowMarkAlignmentCount !==
          (contract.viewport.width <= 380 ? 5 : 0) ||
        capture.compactOverview?.quotaCount !== 10 ||
        capture.compactOverview?.resetCount !== 7 ||
        capture.compactOverview?.untimedCount !== 3 ||
        capture.compactOverview?.wideIdentityVerified !== true ||
        capture.compactOverview?.wideIdentityCount !==
          (contract.viewport.width > 380 ? 1 : 0) ||
        (capture.compactOverview?.violations ?? []).length > 0)
    ) {
      errors.push(`${capture.id} failed the compact Overview visual contract.`);
    }
    if (
      contract.screen === "api-key-connect" &&
      (capture.apiKeyGuide?.verified !== true ||
        capture.apiKeyGuide?.inputPopulated !== true ||
        capture.apiKeyGuide?.primaryEnabled !== true ||
        !(capture.apiKeyGuide?.contrastRatio >= 4.5) ||
        capture.apiKeyGuide?.markPath !== "/provider-marks/elevenlabs.svg" ||
        (capture.apiKeyGuide?.violations ?? []).length > 0)
    ) {
      errors.push(`${capture.id} failed the API-key setup visual contract.`);
    }
  }

  return errors;
}

export const REQUIRED_STORE_ASSET_DIMENSIONS = {
  "chrome-web-store/screenshot-overview-1280x800.png": [1280, 800],
  "chrome-web-store/screenshot-pacing-1280x800.png": [1280, 800],
  "chrome-web-store/screenshot-history-1280x800.png": [1280, 800],
  "chrome-web-store/screenshot-privacy-1280x800.png": [1280, 800],
  "chrome-web-store/small-promo-440x280.png": [440, 280],
  "chrome-web-store/zh_CN/screenshot-overview-1280x800.png": [1280, 800],
  "chrome-web-store/zh_CN/screenshot-pacing-1280x800.png": [1280, 800],
  "chrome-web-store/zh_CN/screenshot-history-1280x800.png": [1280, 800],
  "chrome-web-store/zh_CN/screenshot-privacy-1280x800.png": [1280, 800],
  "github/social-preview-1280x640.png": [1280, 640],
};

const MAX_MARKETING_ASSET_BYTES = {
  "github/social-preview-1280x640.png": 1_000_000,
};

export async function waitForDocumentFonts(page) {
  await page.evaluate(() => document.fonts.ready);
}

export function readPngDimensions(buffer) {
  const png = PNG.sync.read(buffer, { checkCRC: true });

  return {
    width: png.width,
    height: png.height,
  };
}

export function validateStoreAssetDimensions(assets) {
  const errors = [];

  for (const [name, [requiredWidth, requiredHeight]] of Object.entries(
    REQUIRED_STORE_ASSET_DIMENSIONS,
  )) {
    const dimensions = assets[name];

    if (!dimensions) {
      errors.push(`${name} is missing.`);
      continue;
    }

    if (
      dimensions.width !== requiredWidth ||
      dimensions.height !== requiredHeight
    ) {
      errors.push(`${name} must be ${requiredWidth}x${requiredHeight}.`);
    }
  }

  return errors;
}

export function validateMarketingAssetFileSizes(assets) {
  const errors = [];

  for (const [name, maximumBytes] of Object.entries(
    MAX_MARKETING_ASSET_BYTES,
  )) {
    const bytes = assets[name];
    if (typeof bytes === "number" && bytes >= maximumBytes) {
      errors.push(`${name} must be smaller than ${maximumBytes} bytes.`);
    }
  }

  return errors;
}
