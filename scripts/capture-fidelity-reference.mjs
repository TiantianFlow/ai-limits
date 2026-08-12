import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIDELITY_ARTIFACT_ID,
  FIDELITY_FILES_RESPONSE_SHA256,
  FIDELITY_RESPONSE_SHA256,
  buildFidelitySourceComparison,
  buildPinnedReferenceInventory,
  createFidelityCaptureMatrix,
  fidelityHarnessPatch,
  resolveFidelitySnapshotDirectory,
  validatePinnedReferenceInventory,
  validateFidelityReferenceManifest,
} from "./store-assets-contract.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const snapshotDirectory = resolveFidelitySnapshotDirectory({
  argv: process.argv.slice(2),
  env: process.env,
});
const sddDirectory = path.join(
  repositoryRoot,
  ".superpowers",
  "sdd",
  "2026-08-11-magic-patterns-fidelity",
);
const referenceDirectory = path.join(sddDirectory, "task-5-reference");
const sourceDirectory = path.join(referenceDirectory, "source");
const rawDirectory = path.join(referenceDirectory, "raw");
const responseNames = [
  "status-response",
  "artifact-response",
  "history-response",
  "files-response",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeSourcePath(relativePath) {
  const resolved = path.resolve(sourceDirectory, relativePath);
  if (!resolved.startsWith(`${sourceDirectory}${path.sep}`)) {
    throw new Error(`Artifact source path escapes the reference directory: ${relativePath}`);
  }
  return resolved;
}

const responses = Object.fromEntries(
  await Promise.all(
    responseNames.map(async (name) => [
      name,
      await readFile(path.join(snapshotDirectory, name)),
    ]),
  ),
);
const inventory = buildPinnedReferenceInventory({
  statusResponse: responses["status-response"].toString("utf8"),
  artifactResponse: responses["artifact-response"].toString("utf8"),
  historyResponse: responses["history-response"].toString("utf8"),
  filesResponse: responses["files-response"].toString("utf8"),
});

if (inventory.artifactId !== FIDELITY_ARTIFACT_ID) {
  throw new Error(`Pinned active artifact is ${inventory.artifactId}, not ${FIDELITY_ARTIFACT_ID}.`);
}
if (inventory.filesResponseSha256 !== FIDELITY_FILES_RESPONSE_SHA256) {
  throw new Error(
    `Pinned files-response SHA-256 is ${inventory.filesResponseSha256}, not ${FIDELITY_FILES_RESPONSE_SHA256}.`,
  );
}
for (const name of responseNames) {
  const actualHash = sha256(responses[name]);
  const expectedHash = FIDELITY_RESPONSE_SHA256[name];
  if (actualHash !== expectedHash) {
    throw new Error(
      `Pinned ${name} SHA-256 is ${actualHash}, not ${expectedHash}.`,
    );
  }
}

await rm(referenceDirectory, { recursive: true, force: true });
await mkdir(sourceDirectory, { recursive: true });
await mkdir(rawDirectory, { recursive: true });
for (const name of responseNames) {
  await writeFile(path.join(rawDirectory, name), responses[name]);
}
for (const sourceFile of inventory.sourceFiles) {
  const destination = safeSourcePath(sourceFile.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, sourceFile.content, "utf8");
}

const patch = fidelityHarnessPatch();
const patchPath = path.join(referenceDirectory, "harness.patch");
await writeFile(patchPath, patch, "utf8");

const responseFiles = responseNames.map((name) => ({
  name,
  path: `raw/${name}`,
  sha256: sha256(responses[name]),
}));
const missingHistoryEvidence = Object.fromEntries(
  inventory.missingSourceFiles.map((missingPath) => [
    missingPath,
    responses["history-response"].toString("utf8").includes(missingPath),
  ]),
);
const captures = createFidelityCaptureMatrix().map((capture) => ({
  ...capture,
  status: "blocked-missing-source",
}));
const comparison = await buildFidelitySourceComparison(inventory, repositoryRoot);
const comparisonBytes = Buffer.from(
  `${JSON.stringify(comparison, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(referenceDirectory, "source-comparison.json"),
  comparisonBytes,
);
const manifest = {
  schemaVersion: 1,
  artifactId: inventory.artifactId,
  referenceRenderable: false,
  referenceStatus: "blocked",
  authority: "same-session-pinned-mcp-responses",
  responseFiles,
  filesResponse: responseFiles.find((response) => response.name === "files-response"),
  advertisedFiles: inventory.advertisedFiles,
  sourceFiles: inventory.sourceFiles.map(({ path: sourcePath, content, sha256: hash }) => ({
    path: sourcePath,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: hash,
  })),
  missingSourceFiles: inventory.missingSourceFiles,
  unresolvedImports: inventory.unresolvedImports,
  externalDependencies: inventory.externalDependencies,
  exactDependencyVersionsAvailable: false,
  historyHasArtifactId: inventory.historyHasArtifactId,
  historyHasMore: inventory.historyHasMore,
  missingHistoryEvidence,
  harnessPatch: {
    path: "harness.patch",
    sha256: sha256(Buffer.from(patch, "utf8")),
    applied: false,
    purpose:
      "Separate fixed-clock entry shell only; not applied because imported artifact source and exact build dependencies are missing.",
  },
  sourceComparison: {
    path: "source-comparison.json",
    sha256: sha256(comparisonBytes),
  },
  captures,
};
const errors = [
  ...validateFidelityReferenceManifest(manifest),
  ...validatePinnedReferenceInventory(manifest, inventory),
];
if (errors.length) {
  throw new Error(`Invalid reference manifest:\n${errors.join("\n")}`);
}

await writeFile(
  path.join(referenceDirectory, "reference-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(
  `Pinned ${inventory.sourceFiles.length}/${inventory.advertisedFiles.length} artifact files; exact reference rendering is blocked by ${inventory.missingSourceFiles.length} missing files.`,
);
