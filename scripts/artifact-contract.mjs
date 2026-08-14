import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const EXPECTED_DESCRIPTION =
  "Track ChatGPT, Claude, Kimi, Cursor, ElevenLabs, and New API usage, resets, pace, and local history in one Chrome side panel.";

export const EXPECTED_REQUIRED_PERMISSIONS = ["alarms", "sidePanel", "storage"];
export const EXPECTED_OPTIONAL_PERMISSIONS = ["cookies", "scripting"];
export const EXPECTED_OPTIONAL_ORIGINS = [
  "https://api.elevenlabs.io/*",
  "https://chatgpt.com/*",
  "https://claude.ai/*",
  "https://cursor.com/*",
  "https://www.kimi.com/*",
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

export const FORBIDDEN_RELEASE_LITERALS = [
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

const SIDE_PANEL_CREDENTIAL_BOUNDARIES = [
  "aiLimitsCredentials",
  "TRUSTED_CONTEXTS",
  "xi-api-key",
  "/v1/user/subscription",
  "aiLimitsPermissionIntents",
  "connectionRevision",
  "providerRegistry",
];
const KEY_SHAPED_VALUE = /\bsk[-_][A-Za-z0-9_-]{20,}\b/;
const WORKSTATION_PATH =
  /(?:\/Users\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/u;

function hasExactMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

export function validateBuildManifest(manifest, packageVersion) {
  const errors = [];

  if (manifest.manifest_version !== 3) {
    errors.push("Expected manifest_version to be 3.");
  }
  if (manifest.version !== packageVersion || manifest.version !== "0.3.0") {
    errors.push("Expected manifest version 0.3.0 derived from package.json.");
  }
  if (manifest.name !== "AI Limits") {
    errors.push('Expected manifest name to be "AI Limits".');
  }
  if (
    manifest.description !== EXPECTED_DESCRIPTION ||
    EXPECTED_DESCRIPTION.length > 132
  ) {
    errors.push(
      "Expected the manifest description to match the Chrome Web Store short description within 132 characters.",
    );
  }
  if (manifest.side_panel?.default_path !== "sidepanel.html") {
    errors.push('Expected side_panel.default_path to be "sidepanel.html".');
  }
  if (!hasExactMembers(manifest.permissions, EXPECTED_REQUIRED_PERMISSIONS)) {
    errors.push("Expected permissions to be exactly alarms, sidePanel, storage.");
  }
  if (
    !hasExactMembers(
      manifest.optional_host_permissions,
      EXPECTED_OPTIONAL_ORIGINS,
    )
  ) {
    errors.push("Expected the exact static and dynamic optional provider origins.");
  }
  if (manifest.host_permissions !== undefined) {
    errors.push("Expected no required host_permissions.");
  }
  if (
    !hasExactMembers(
      manifest.optional_permissions,
      EXPECTED_OPTIONAL_PERMISSIONS,
    )
  ) {
    errors.push('Expected optional_permissions to equal ["cookies", "scripting"].');
  }
  if (manifest.minimum_chrome_version !== "116") {
    errors.push('Expected minimum_chrome_version to equal "116".');
  }
  if (
    JSON.stringify(manifest.icons) !==
    JSON.stringify({
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    })
  ) {
    errors.push("Expected the complete extension icon set.");
  }
  if (
    typeof manifest.background?.service_worker !== "string" ||
    manifest.background.service_worker.length === 0
  ) {
    errors.push("Expected a background service worker.");
  }

  return errors;
}

export function validateSidePanelAssetText(text) {
  const errors = [];
  for (const boundary of SIDE_PANEL_CREDENTIAL_BOUNDARIES) {
    if (text.includes(boundary)) {
      errors.push(
        `Built side-panel assets contain forbidden background credential boundary: ${boundary}.`,
      );
    }
  }
  return errors;
}

export function validateReleaseTextEntries(entries) {
  const errors = [];
  const combinedText = Object.values(entries).join("\n");

  for (const literal of FORBIDDEN_RELEASE_LITERALS) {
    if (combinedText.includes(literal)) {
      errors.push(`Release text contains synthetic credential literal: ${literal}.`);
    }
  }

  for (const [name, text] of Object.entries(entries)) {
    if (KEY_SHAPED_VALUE.test(text)) {
      errors.push(`Release text contains a key-shaped credential value in ${name}.`);
    }
  }

  return errors;
}

export function validateReleaseEntryNames(names) {
  const errors = [];

  for (const name of names) {
    const lower = String(name).toLowerCase();
    const components = String(name).split("/");
    let error;

    if (
      String(name).startsWith("/") ||
      String(name).startsWith("\\") ||
      /^[A-Za-z]:[\\/]/u.test(String(name))
    ) {
      error = `Release entry is absolute: ${name}.`;
    } else if (
      components.includes("..") ||
      components.includes(".") ||
      (components.includes("") && !String(name).endsWith("/"))
    ) {
      error = `Release entry contains traversal or an invalid segment: ${name}.`;
    } else if (String(name).includes("\\")) {
      error = `Release entry contains a non-portable path separator: ${name}.`;
    } else if (
      components.some(
        (component) => component.toLowerCase() === ".superpowers",
      ) ||
      lower === "docs/superpowers" ||
      lower.startsWith("docs/superpowers/")
    ) {
      error = `Release entry exposes Superpowers workflow files: ${name}.`;
    } else if (lower.endsWith(".map")) {
      error = `Release entry contains a source map: ${name}.`;
    } else if (components.some((component) => component.startsWith("."))) {
      error = `Release entry contains a dotfile: ${name}.`;
    } else if (
      /(?:^|\/)(?:release-evidence|test-results|playwright-report|coverage)(?:\/|$)/iu.test(
        String(name),
      ) ||
      /(?:^|\/)task-\d+-report\.md$/iu.test(String(name))
    ) {
      error = `Release entry contains generated evidence: ${name}.`;
    }

    if (error) errors.push(error);
  }
  return errors;
}

export function validateReleaseArtifactContents(entries) {
  const textEntries = Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      name,
      typeof value === "string" ? value : Buffer.from(value).toString("utf8"),
    ]),
  );
  const errors = validateReleaseTextEntries(textEntries);

  for (const [name, text] of Object.entries(textEntries)) {
    if (WORKSTATION_PATH.test(text)) {
      errors.push(`Release file contains a workstation path in ${name}.`);
    }
    if (text.includes(".superpowers") || text.includes("docs/superpowers/")) {
      errors.push(`Release file exposes a Superpowers workflow path in ${name}.`);
    }
  }
  return errors;
}

function compareReleaseEntries(reference, candidate, candidateLabel) {
  const errors = [];
  const referenceNames = Object.keys(reference).sort();
  const candidateNames = Object.keys(candidate).sort();

  for (const name of referenceNames) {
    if (!(name in candidate)) {
      errors.push(`${candidateLabel} is missing WXT output file ${name}.`);
    } else if (
      !Buffer.from(candidate[name]).equals(Buffer.from(reference[name]))
    ) {
      errors.push(`${candidateLabel} bytes differ from WXT output for ${name}.`);
    }
  }
  for (const name of candidateNames) {
    if (!(name in reference)) {
      errors.push(
        `${candidateLabel} has unexpected file ${name} compared with WXT output.`,
      );
    }
  }
  return errors;
}

export function validateReleaseArtifactParity({ zip, output, dist }) {
  const errors = [];
  for (const entries of [zip, output, dist].filter(Boolean)) {
    errors.push(...validateReleaseEntryNames(Object.keys(entries)));
    errors.push(...validateReleaseArtifactContents(entries));
  }
  if (zip) errors.push(...compareReleaseEntries(output, zip, "ZIP"));
  errors.push(...compareReleaseEntries(output, dist, "Staged unpacked"));
  return errors;
}

export async function readReleaseDirectoryEntries(root) {
  const entries = {};

  async function visit(directory, relativeDirectory = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativeName = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absoluteName = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absoluteName, relativeName);
      } else if (entry.isFile()) {
        entries[relativeName] = await readFile(absoluteName);
      } else {
        throw new Error(
          `Release tree contains a non-regular entry: ${relativeName}.`,
        );
      }
    }
  }

  await visit(path.resolve(root));
  return entries;
}
