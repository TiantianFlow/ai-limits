import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceDirectory = resolve(".output/chrome-mv3");
const targetDirectory = resolve("dist/chrome-mv3");
const sourceManifest = JSON.parse(
  await readFile(resolve(sourceDirectory, "manifest.json"), "utf8"),
);

if (sourceManifest.manifest_version !== 3) {
  throw new Error("Refusing to stage a build that is not Manifest V3.");
}

await rm(targetDirectory, { recursive: true, force: true });
await mkdir(dirname(targetDirectory), { recursive: true });
await cp(sourceDirectory, targetDirectory, { recursive: true });

console.log(`AI Limits unpacked build staged: ${targetDirectory}`);
