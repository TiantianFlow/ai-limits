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
];
const KEY_SHAPED_VALUE = /\bsk[-_][A-Za-z0-9_-]{20,}\b/;

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
  if (manifest.version !== packageVersion || manifest.version !== "0.2.3") {
    errors.push("Expected manifest version 0.2.3 derived from package.json.");
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
