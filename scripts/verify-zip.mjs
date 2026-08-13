import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

import {
  validateBuildManifest,
  validateReleaseTextEntries,
  validateSidePanelAssetText,
} from "./artifact-contract.mjs";

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const archivePath = resolve(
  ".output",
  `${packageJson.name}-${packageJson.version}-chrome.zip`,
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

for (const error of validateBuildManifest(manifest, packageJson.version)) {
  throw new Error(`ZIP manifest: ${error}`);
}
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

assert(
  !JSON.stringify(manifest).includes("auth.kimi.com"),
  "Expected the ZIP manifest not to request auth.kimi.com.",
);
assert(
  [16, 32, 48, 128].every((size) => {
    const iconPath = manifest.icons?.[size];
    return typeof iconPath === "string" && entries.includes(iconPath);
  }),
  "Expected the complete extension icon set in the ZIP.",
);

const textEntries = Object.fromEntries(
  entries
    .filter((entry) => /\.(?:css|html|js|json|md|svg)$/u.test(entry))
    .map((entry) => [entry, strFromU8(archive[entry])]),
);
for (const error of validateReleaseTextEntries(textEntries)) {
  throw new Error(error);
}

const sidePanelText = Object.entries(textEntries)
  .filter(
    ([entry]) =>
      entry === sidePanel ||
      entry.startsWith("assets/") ||
      entry.startsWith("chunks/"),
  )
  .map(([, contents]) => contents)
  .join("\n");
for (const error of validateSidePanelAssetText(sidePanelText)) {
  throw new Error(error);
}

console.log(`AI Limits ZIP verified: ${archivePath}`);
