import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(".output/chrome-mv3");
const manifestPath = resolve(outputDirectory, "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedPermissions = ["alarms", "sidePanel", "storage"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(manifest.manifest_version === 3, "Expected manifest_version to be 3.");
assert(manifest.name === "AI Limits", 'Expected manifest name to be "AI Limits".');
assert(
  manifest.side_panel?.default_path === "sidepanel.html",
  'Expected side_panel.default_path to be "sidepanel.html".',
);
assert(
  JSON.stringify([...(manifest.permissions ?? [])].sort()) ===
    JSON.stringify(expectedPermissions),
  "Expected permissions to be exactly alarms, sidePanel, storage.",
);
assert(
  JSON.stringify([...(manifest.optional_host_permissions ?? [])].sort()) ===
    JSON.stringify([
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://cursor.com/*",
      "https://www.kimi.com/*",
    ]),
  "Expected the four exact optional provider origins.",
);
assert(
  JSON.stringify([...(manifest.optional_permissions ?? [])].sort()) ===
    JSON.stringify(["cookies"]),
  'Expected optional_permissions to equal ["cookies"].',
);
assert(
  manifest.minimum_chrome_version === "116",
  'Expected minimum_chrome_version to equal "116".',
);
assert(
  typeof manifest.background?.service_worker === "string" &&
    manifest.background.service_worker.length > 0,
  "Expected a background service worker.",
);

await access(resolve(outputDirectory, "sidepanel.html"), constants.F_OK);

console.log("AI Limits build verified");
