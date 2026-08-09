import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const EXPECTED_VERSION = "0.1.0";
const EXPECTED_PERMISSIONS = ["alarms", "sidePanel", "storage"];
const EXPECTED_OPTIONAL_PERMISSIONS = ["cookies", "scripting"];
const EXPECTED_OPTIONAL_ORIGINS = [
  "https://chatgpt.com/*",
  "https://claude.ai/*",
  "https://cursor.com/*",
  "https://www.kimi.com/*",
];
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const archivePath = resolve(
  ".output",
  `${packageJson.name}-${EXPECTED_VERSION}-chrome.zip`,
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasExactMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
const entries = Object.keys(archive);
const manifestEntries = entries.filter(
  (entry) => entry === "manifest.json" || entry.endsWith("/manifest.json"),
);

assert(
  manifestEntries.length === 1 && manifestEntries[0] === "manifest.json",
  "Expected exactly one manifest.json at the archive root.",
);

const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
const serviceWorker = manifest.background?.service_worker;
const sidePanel = manifest.side_panel?.default_path;

assert(manifest.version === EXPECTED_VERSION, "Expected ZIP version to be 0.1.0.");
assert(manifest.manifest_version === 3, "Expected ZIP to contain Manifest V3.");
assert(
  manifest.minimum_chrome_version === "116",
  "Expected minimum Chrome version 116.",
);
assert(
  sidePanel === "sidepanel.html" && entries.includes(sidePanel),
  "Expected the manifest side panel entrypoint in the ZIP.",
);
assert(
  typeof serviceWorker === "string" && entries.includes(serviceWorker),
  "Expected the manifest background service worker in the ZIP.",
);
assert(
  entries.every((entry) => !entry.toLowerCase().endsWith(".map")),
  "Expected the ZIP to contain no source maps.",
);
assert(
  entries.every((entry) =>
    entry
      .split("/")
      .filter(Boolean)
      .every((component) => !component.startsWith(".")),
  ),
  "Expected the ZIP to contain no dotfiles or .env files.",
);

const declaredPermissions = [
  ...(manifest.permissions ?? []),
  ...(manifest.optional_permissions ?? []),
];
assert(
  !declaredPermissions.includes("tabs"),
  'Expected the ZIP manifest not to request the broad "tabs" permission.',
);
assert(
  hasExactMembers(manifest.permissions, EXPECTED_PERMISSIONS),
  "Expected exact required permissions: alarms, sidePanel, storage.",
);
assert(
  hasExactMembers(
    manifest.optional_permissions,
    EXPECTED_OPTIONAL_PERMISSIONS,
  ),
  "Expected exact optional permissions: cookies, scripting.",
);
assert(
  hasExactMembers(
    manifest.optional_host_permissions,
    EXPECTED_OPTIONAL_ORIGINS,
  ),
  "Expected the four exact optional provider origins.",
);
assert(
  !JSON.stringify(manifest).includes("auth.kimi.com"),
  "Expected the ZIP manifest not to request auth.kimi.com.",
);

console.log(`AI Limits ZIP verified: ${archivePath}`);
