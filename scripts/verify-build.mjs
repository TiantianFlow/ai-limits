import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

import {
  validateBuildManifest,
  validateReleaseTextEntries,
  validateSidePanelAssetText,
} from "./artifact-contract.mjs";

const outputDirectory = resolve(".output/chrome-mv3");
const stagedDirectory = resolve("dist/chrome-mv3");
const manifestPath = resolve(outputDirectory, "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const error of validateBuildManifest(manifest, packageJson.version)) {
  throw new Error(error);
}

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

const textEntries = {};
for (const entry of await readdir(outputDirectory, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const relativePath = resolve(entry.parentPath, entry.name).slice(
    `${outputDirectory}/`.length,
  );
  if (!/\.(?:css|html|js|json|md|svg)$/u.test(relativePath)) continue;
  textEntries[relativePath] = await readFile(
    resolve(outputDirectory, relativePath),
    "utf8",
  );
}

for (const error of validateReleaseTextEntries(textEntries)) {
  throw new Error(error);
}

const sidePanelText = Object.entries(textEntries)
  .filter(
    ([relativePath]) =>
      relativePath === manifest.side_panel.default_path ||
      relativePath.startsWith("assets/") ||
      relativePath.startsWith("chunks/"),
  )
  .map(([, contents]) => contents)
  .join("\n");
for (const error of validateSidePanelAssetText(sidePanelText)) {
  throw new Error(error);
}

console.log("AI Limits build verified");
