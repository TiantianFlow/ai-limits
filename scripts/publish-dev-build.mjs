import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceRoot = resolve(".");
const destinationRoot = resolve(
  process.env.AI_LIMITS_PUBLISH_DIR ??
    `${process.env.HOME ?? ""}/open-source/ai-limits`,
);

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

if (destinationRoot === sourceRoot) {
  console.log(
    "AI Limits dev publish skipped: destination is the current working directory.",
  );
  process.exit(0);
}

if (!(await isDirectory(destinationRoot))) {
  console.log(
    `AI Limits dev publish skipped: destination does not exist (${destinationRoot}).`,
  );
  process.exit(0);
}

async function replaceDirectory(relativePath) {
  const source = resolve(sourceRoot, relativePath);
  const target = resolve(destinationRoot, relativePath);
  if (!(await isDirectory(source))) {
    return false;
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return true;
}

const published = [];

for (const relativePath of ["dist/chrome-mv3", ".output/chrome-mv3"]) {
  if (await replaceDirectory(relativePath)) {
    published.push(relativePath);
  }
}

const packageJson = JSON.parse(
  await readFile(resolve(sourceRoot, "package.json"), "utf8"),
);
const zipRelativePath = `.output/ai-limits-${packageJson.version}-chrome.zip`;
const zipSource = resolve(sourceRoot, zipRelativePath);
const zipTarget = resolve(destinationRoot, zipRelativePath);

if (await pathExists(zipSource)) {
  await mkdir(dirname(zipTarget), { recursive: true });
  await cp(zipSource, zipTarget);
  published.push(zipRelativePath);
}

if (published.length === 0) {
  console.log(
    `AI Limits dev publish skipped: no built artifacts to copy into ${destinationRoot}.`,
  );
} else {
  const zipNote = published.includes(zipRelativePath)
    ? ""
    : "; zip not built yet";
  console.log(
    `AI Limits dev publish: refreshed ${published.join(", ")} -> ${destinationRoot}${zipNote}`,
  );
}
