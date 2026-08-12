import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import {
  FIDELITY_ARTIFACT_ID,
  FIDELITY_RESPONSE_SHA256,
  buildFidelitySourceComparison,
  buildPinnedReferenceInventory,
  captureMatchesSha256,
  fidelityHarnessPatch,
  readAuthenticatedEvidenceFile,
  resolveContainedCapturePath,
  validatePinnedReferenceInventory,
  validateFidelityProductionManifest,
  validateFidelityReferenceManifest,
} from "./store-assets-contract.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sddDirectory = path.join(
  repositoryRoot,
  ".superpowers",
  "sdd",
  "2026-08-11-magic-patterns-fidelity",
);
const referenceDirectory = path.join(sddDirectory, "task-5-reference");
const productionDirectory = path.join(sddDirectory, "task-5-production");
const reviewDirectory = path.join(sddDirectory, "task-5-review");
const contactDirectory = path.join(reviewDirectory, "contact-sheets");
const comparisonDirectory = path.join(reviewDirectory, "comparisons");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function scaledPng(source, targetWidth) {
  const ratio = targetWidth / source.width;
  const targetHeight = Math.max(1, Math.round(source.height * ratio));
  const target = new PNG({ width: targetWidth, height: targetHeight });
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      source.height - 1,
      Math.floor((y / targetHeight) * source.height),
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.floor((x / targetWidth) * source.width),
      );
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return target;
}

function fill(png, red, green, blue, alpha = 255) {
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = alpha;
  }
}

function contactSheet(images, targetWidth = 230, columns = 2) {
  const gap = 14;
  const padding = 14;
  const scaled = images.map(({ id, png }) => ({
    id,
    png: scaledPng(png, targetWidth),
  }));
  const rows = [];
  for (let index = 0; index < scaled.length; index += columns) {
    rows.push(scaled.slice(index, index + columns));
  }
  const rowHeights = rows.map((row) =>
    Math.max(...row.map(({ png }) => png.height)),
  );
  const width = padding * 2 + columns * targetWidth + (columns - 1) * gap;
  const height =
    padding * 2 +
    rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
    Math.max(0, rows.length - 1) * gap;
  const sheet = new PNG({ width, height });
  fill(sheet, 224, 224, 228);
  const placements = [];
  let y = padding;
  rows.forEach((row, rowIndex) => {
    row.forEach(({ id, png }, columnIndex) => {
      const x = padding + columnIndex * (targetWidth + gap);
      PNG.bitblt(png, sheet, 0, 0, png.width, png.height, x, y);
      placements.push({ id, x, y, width: png.width, height: png.height });
    });
    y += rowHeights[rowIndex] + gap;
  });
  return { png: sheet, placements };
}

function sideBySide(reference, production) {
  const gap = 12;
  const output = new PNG({
    width: reference.width + production.width + gap,
    height: Math.max(reference.height, production.height),
  });
  fill(output, 224, 224, 228);
  PNG.bitblt(reference, output, 0, 0, reference.width, reference.height, 0, 0);
  PNG.bitblt(
    production,
    output,
    0,
    0,
    production.width,
    production.height,
    reference.width + gap,
    0,
  );
  return output;
}

function translucentOverlay(reference, production) {
  assert(
    reference.width === production.width && reference.height === production.height,
    "Overlay inputs must have identical dimensions.",
  );
  const output = new PNG({ width: reference.width, height: reference.height });
  for (let offset = 0; offset < output.data.length; offset += 4) {
    output.data[offset] = Math.round(
      (reference.data[offset] + production.data[offset]) / 2,
    );
    output.data[offset + 1] = Math.round(
      (reference.data[offset + 1] + production.data[offset + 1]) / 2,
    );
    output.data[offset + 2] = Math.round(
      (reference.data[offset + 2] + production.data[offset + 2]) / 2,
    );
    output.data[offset + 3] = 255;
  }
  return output;
}

const referenceManifestPath = path.join(
  referenceDirectory,
  "reference-manifest.json",
);
const productionManifestPath = path.join(
  productionDirectory,
  "production-manifest.json",
);
const referenceManifest = JSON.parse(
  await readFile(referenceManifestPath, "utf8"),
);
const productionManifest = JSON.parse(
  await readFile(productionManifestPath, "utf8"),
);
const referenceErrors = validateFidelityReferenceManifest(referenceManifest);
const productionErrors = validateFidelityProductionManifest(productionManifest);
assert(
  referenceErrors.length === 0,
  `Reference manifest errors:\n${referenceErrors.join("\n")}`,
);
assert(
  productionErrors.length === 0,
  `Production manifest errors:\n${productionErrors.join("\n")}`,
);

const responseBytes = Object.fromEntries(
  await Promise.all(
    Object.entries(FIDELITY_RESPONSE_SHA256).map(async ([name, expectedHash]) => {
      const response = referenceManifest.responseFiles.find(
        (candidate) => candidate.name === name,
      );
      assert(response, `Reference manifest is missing ${name}.`);
      return [
        name,
        await readAuthenticatedEvidenceFile(
          referenceDirectory,
          response.path,
          expectedHash,
        ),
      ];
    }),
  ),
);
const inventory = buildPinnedReferenceInventory({
  statusResponse: responseBytes["status-response"].toString("utf8"),
  artifactResponse: responseBytes["artifact-response"].toString("utf8"),
  historyResponse: responseBytes["history-response"].toString("utf8"),
  filesResponse: responseBytes["files-response"].toString("utf8"),
});
assert(
  inventory.artifactId === FIDELITY_ARTIFACT_ID,
  "Authenticated reference responses changed the active artifact identity.",
);
const inventoryErrors = validatePinnedReferenceInventory(
  referenceManifest,
  inventory,
);
assert(
  inventoryErrors.length === 0,
  `Authenticated reference inventory errors:\n${inventoryErrors.join("\n")}`,
);
for (const source of inventory.sourceFiles) {
  await readAuthenticatedEvidenceFile(
    referenceDirectory,
    path.posix.join("source", source.path),
    source.sha256,
  );
}

const expectedPatch = Buffer.from(fidelityHarnessPatch(), "utf8");
const expectedPatchHash = sha256(expectedPatch);
assert(
  referenceManifest.harnessPatch.sha256 === expectedPatchHash,
  "Reference harness patch does not match the pinned harness contract.",
);
const patchBytes = await readAuthenticatedEvidenceFile(
  referenceDirectory,
  referenceManifest.harnessPatch.path,
  expectedPatchHash,
);
assert(
  Buffer.compare(patchBytes, expectedPatch) === 0,
  "Reference harness patch bytes changed.",
);

const expectedSourceComparison = Buffer.from(
  `${JSON.stringify(
    await buildFidelitySourceComparison(inventory, repositoryRoot),
    null,
    2,
  )}\n`,
  "utf8",
);
const expectedSourceComparisonHash = sha256(expectedSourceComparison);
assert(
  referenceManifest.sourceComparison.sha256 === expectedSourceComparisonHash,
  "Reference source-comparison manifest hash is not derived from authenticated evidence.",
);
const sourceComparisonBytes = await readAuthenticatedEvidenceFile(
  referenceDirectory,
  referenceManifest.sourceComparison.path,
  expectedSourceComparisonHash,
);
assert(
  Buffer.compare(sourceComparisonBytes, expectedSourceComparison) === 0,
  "Reference source-comparison evidence changed.",
);

const productionImages = new Map();
for (const capture of productionManifest.captures) {
  const capturePath = resolveContainedCapturePath(
    productionDirectory,
    capture.path,
  );
  const buffer = await readFile(capturePath);
  assert(
    captureMatchesSha256(buffer, capture.sha256),
    `${capture.id} SHA-256 changed.`,
  );
  const png = PNG.sync.read(buffer, { checkCRC: true });
  assert(
    png.width === capture.dimensions.width &&
      png.height === capture.dimensions.height,
    `${capture.id} PNG dimensions changed.`,
  );
  productionImages.set(capture.id, png);
}

await mkdir(contactDirectory, { recursive: true });
await rm(comparisonDirectory, { recursive: true, force: true });
await mkdir(comparisonDirectory, { recursive: true });
const contactSheets = [];
for (const width of [340, 400, 460]) {
  for (const theme of ["light", "dark"]) {
    for (const group of ["base", "states"]) {
      const captures = productionManifest.captures.filter((capture) => {
        const isBase = capture.state === "default" && capture.mode === "used";
        return (
          capture.viewport.width === width &&
          capture.theme === theme &&
          (group === "base" ? isBase : !isBase)
        );
      });
      const sheet = contactSheet(
        captures.map((capture) => ({
          id: capture.id,
          png: productionImages.get(capture.id),
        })),
      );
      const fileName = `${group}-${width}-${theme}.png`;
      const buffer = PNG.sync.write(sheet.png);
      await writeFile(path.join(contactDirectory, fileName), buffer);
      contactSheets.push({
        fileName,
        width,
        theme,
        group,
        sha256: sha256(buffer),
        placements: sheet.placements,
      });
    }
  }
}
await writeFile(
  path.join(contactDirectory, "index.json"),
  `${JSON.stringify(contactSheets, null, 2)}\n`,
  "utf8",
);

const capturedReferences = referenceManifest.captures.filter(
  (capture) => capture.status === "captured",
);
assert(
  referenceManifest.referenceRenderable || capturedReferences.length === 0,
  "Non-renderable reference manifests cannot request pixel comparisons.",
);
const pixelComparisons = [];
for (const referenceCapture of capturedReferences) {
  const productionCapture = productionManifest.captures.find(
    (capture) => capture.id === referenceCapture.id,
  );
  if (!productionCapture || !referenceCapture.path) {
    continue;
  }
  const referencePath = resolveContainedCapturePath(
    referenceDirectory,
    referenceCapture.path,
  );
  const referenceBuffer = await readFile(referencePath);
  assert(
    captureMatchesSha256(referenceBuffer, referenceCapture.sha256),
    `${referenceCapture.id} reference SHA-256 changed.`,
  );
  const reference = PNG.sync.read(referenceBuffer, { checkCRC: true });
  const production = productionImages.get(productionCapture.id);
  const side = PNG.sync.write(sideBySide(reference, production));
  const sideName = `${referenceCapture.id}-side-by-side.png`;
  await writeFile(path.join(comparisonDirectory, sideName), side);
  const comparison = {
    id: referenceCapture.id,
    sideBySide: sideName,
    sideBySideSha256: sha256(side),
  };
  if (
    reference.width === production.width &&
    reference.height === production.height
  ) {
    const overlay = PNG.sync.write(translucentOverlay(reference, production));
    const overlayName = `${referenceCapture.id}-overlay.png`;
    await writeFile(path.join(comparisonDirectory, overlayName), overlay);
    comparison.overlay = overlayName;
    comparison.overlaySha256 = sha256(overlay);
  }
  pixelComparisons.push(comparison);
}

const summary = {
  schemaVersion: 1,
  productionCaptureCount: productionManifest.captures.length,
  productionManifestSha256: sha256(
    await readFile(productionManifestPath),
  ),
  referenceManifestSha256: sha256(await readFile(referenceManifestPath)),
  referenceRenderable: referenceManifest.referenceRenderable,
  referenceMissingSourceFiles: referenceManifest.missingSourceFiles,
  contactSheets,
  pixelComparisons,
  pixelComparisonStatus: referenceManifest.referenceRenderable
    ? "created-for-reproducible-reference-captures"
    : "not-created-reference-export-incomplete",
};
await writeFile(
  path.join(reviewDirectory, "verification-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

console.log(
  `Verified ${summary.productionCaptureCount} production captures and wrote ${contactSheets.length} contact sheets; ${pixelComparisons.length} exact reference comparisons were reproducible.`,
);
