import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(".output/chrome-mv3");
const stagedDirectory = resolve("dist/chrome-mv3");
const manifestPath = resolve(outputDirectory, "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const expectedPermissions = ["alarms", "sidePanel", "storage"];
const expectedDescription =
  "See ChatGPT, Claude, Kimi, and Cursor usage as Used or Left, reset timing, pace, and local quota history in one Chrome side panel.";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(manifest.manifest_version === 3, "Expected manifest_version to be 3.");
assert(
  manifest.version === packageJson.version && manifest.version === "0.1.0",
  "Expected manifest version 0.1.0 derived from package.json.",
);
assert(manifest.name === "AI Limits", 'Expected manifest name to be "AI Limits".');
assert(
  manifest.description === expectedDescription,
  "Expected the manifest description to match the Chrome Web Store short description.",
);
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
  manifest.host_permissions === undefined,
  "Expected no required host_permissions.",
);
assert(
  JSON.stringify([...(manifest.optional_permissions ?? [])].sort()) ===
    JSON.stringify(["cookies", "scripting"]),
  'Expected optional_permissions to equal ["cookies", "scripting"].',
);
assert(
  manifest.minimum_chrome_version === "116",
  'Expected minimum_chrome_version to equal "116".',
);
assert(
  JSON.stringify(manifest.icons) ===
    JSON.stringify({
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    }),
  "Expected the complete extension icon set.",
);
assert(
  typeof manifest.background?.service_worker === "string" &&
    manifest.background.service_worker.length > 0,
  "Expected a background service worker.",
);

await access(resolve(outputDirectory, "sidepanel.html"), constants.F_OK);
await Promise.all(
  Object.values(manifest.icons).map((iconPath) =>
    access(resolve(outputDirectory, iconPath), constants.F_OK),
  ),
);
await access(
  resolve(outputDirectory, manifest.background.service_worker),
  constants.F_OK,
);
const stagedManifest = JSON.parse(
  await readFile(resolve(stagedDirectory, "manifest.json"), "utf8"),
);
assert(
  JSON.stringify(stagedManifest) === JSON.stringify(manifest),
  "Expected the visible unpacked build to match the verified WXT build.",
);

console.log("AI Limits build verified");
