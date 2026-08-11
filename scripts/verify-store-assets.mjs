import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readPngDimensions,
  REQUIRED_STORE_ASSET_DIMENSIONS,
  validateStoreAssetDimensions,
} from "./store-assets-contract.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetDirectory = path.join(repositoryRoot, "store-assets", "chrome-web-store");
const dimensions = {};
const errors = [];

for (const name of Object.keys(REQUIRED_STORE_ASSET_DIMENSIONS)) {
  const assetPath = path.join(assetDirectory, name);

  try {
    dimensions[name] = readPngDimensions(await readFile(assetPath));
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

errors.push(...validateStoreAssetDimensions(dimensions));

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${Object.keys(REQUIRED_STORE_ASSET_DIMENSIONS).length} PNG assets at their required dimensions.`,
  );
}
