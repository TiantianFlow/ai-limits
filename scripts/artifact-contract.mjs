import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

export const EXPECTED_DESCRIPTION =
  "Track subscription usage, resets, pace, and local history for your connected AI providers in one Chrome side panel.";

export const EXPECTED_REQUIRED_PERMISSIONS = ["alarms", "sidePanel", "storage"];
export const EXPECTED_OPTIONAL_PERMISSIONS = ["cookies", "scripting"];
export const EXPECTED_OPTIONAL_ORIGINS = [
  "https://api.elevenlabs.io/*",
  "https://chatgpt.com/*",
  "https://claude.ai/*",
  "https://cursor.com/*",
  "https://grok.com/*",
  "https://www.kimi.com/*",
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
  "https://api.deepseek.com/*",
  "https://api.moonshot.ai/*",
  "https://api.deepinfra.com/*",
  "https://api.fireworks.ai/*",
  "https://api.openai.com/*",
  "https://api.groq.com/*",
  "https://openrouter.ai/*",
  "https://admin.mistral.ai/*",
  "https://console.mistral.ai/*",
  "https://www.perplexity.ai/*",
];

const joinedLiteral = (...parts) => parts.join("");
const upstreamSourceBasenames = [
  joinedLiteral("DeepInfra", "UsageFetcher"),
  joinedLiteral("DeepSeek", "UsageFetcher"),
  joinedLiteral("Fireworks", "UsageFetcher"),
  joinedLiteral("LiteLLM", "UsageFetcher"),
  joinedLiteral("LiteLLM", "UsageFetcherTests"),
  joinedLiteral("LLMProxy", "UsageFetcher"),
  joinedLiteral("LLMProxy", "UsageFetcherTests"),
  joinedLiteral("Moonshot", "Region"),
  joinedLiteral("Moonshot", "UsageFetcher"),
  joinedLiteral("Groq", "UsageFetcher"),
  joinedLiteral("Groq", "UsageFetcherTests"),
  joinedLiteral("Groq", "SettingsReader"),
  joinedLiteral("Groq", "ProviderDescriptor"),
  joinedLiteral("OpenAIAPI", "UsageFetcher"),
  joinedLiteral("OpenAIAPI", "UsageFetcherTests"),
  joinedLiteral("OpenAIAPI", "UsageResponses"),
  joinedLiteral("OpenAIAPI", "CreditBalanceFetcher"),
  joinedLiteral("OpenAIAPI", "CreditBalanceTests"),
  joinedLiteral("OpenAIAPI", "ProviderDescriptor"),
  joinedLiteral("OpenRouter", "UsageStatsTests"),
  joinedLiteral("OpenRouter", "SettingsReader"),
  joinedLiteral("OpenRouter", "ProviderDescriptor"),
  joinedLiteral("Mistral", "UsageFetcher"),
  joinedLiteral("Mistral", "Models"),
  joinedLiteral("Perplexity", "UsageFetcher"),
  joinedLiteral("Perplexity", "Models"),
  joinedLiteral("Perplexity", "UsageSnapshot"),
];

export const FORBIDDEN_TRACKED_FILE_LITERALS = [
  joinedLiteral("Codex", "Bar"),
  joinedLiteral("Codex", "BarCore"),
  joinedLiteral("Codex", "BarApp"),
  joinedLiteral("Codex", "BarTests"),
  ...upstreamSourceBasenames,
];

export const FORBIDDEN_RELEASE_LITERALS = [
  "active-test-key",
  "candidate-key",
  "deferred-candidate-key",
  "ephemeral-api-key",
  "latest-key",
  "must-never-escape",
  "new-candidate-key",
  "not-a-real-elevenlabs-key",
  "old-key",
  "prior-active-key",
  "rejected-test-key",
  "replacement-key",
  "saved-key",
  "synthetic-api-key",
  "synthetic-candidate-key",
  ...FORBIDDEN_TRACKED_FILE_LITERALS,
];

const SIDE_PANEL_CREDENTIAL_BOUNDARIES = [
  "aiLimitsCredentials",
  "TRUSTED_CONTEXTS",
  "xi-api-key",
  "/v1/user/subscription",
  "aiLimitsPermissionIntents",
  "connectionRevision",
  "providerRegistry",
];
const KEY_SHAPED_VALUE = /\bsk[-_][A-Za-z0-9_-]{20,}\b/;
const WORKSTATION_PATH =
  /(?:\/Users\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/u;

function hasExactMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

export function validateBuildManifest(manifest, packageVersion) {
  const errors = [];

  if (manifest.manifest_version !== 3) {
    errors.push("Expected manifest_version to be 3.");
  }
  if (manifest.version !== packageVersion || manifest.version !== "0.4.3") {
    errors.push("Expected manifest version 0.4.3 derived from package.json.");
  }
  if (manifest.default_locale !== "en") {
    errors.push('Expected manifest default_locale to be "en".');
  }
  if (manifest.name !== "__MSG_manifest_name__") {
    errors.push('Expected manifest name to be "__MSG_manifest_name__".');
  }
  if (manifest.description !== "__MSG_manifest_description__") {
    errors.push(
      'Expected manifest description to be "__MSG_manifest_description__".',
    );
  }
  if (EXPECTED_DESCRIPTION.length > 132) {
    errors.push(
      "Expected the English catalog description to stay within 132 characters.",
    );
  }
  if (manifest.action?.default_title !== "__MSG_manifest_actionTitle__") {
    errors.push(
      'Expected action.default_title to be "__MSG_manifest_actionTitle__".',
    );
  }
  if (manifest.side_panel?.default_path !== "sidepanel.html") {
    errors.push('Expected side_panel.default_path to be "sidepanel.html".');
  }
  if (!hasExactMembers(manifest.permissions, EXPECTED_REQUIRED_PERMISSIONS)) {
    errors.push("Expected permissions to be exactly alarms, sidePanel, storage.");
  }
  if (
    !hasExactMembers(
      manifest.optional_host_permissions,
      EXPECTED_OPTIONAL_ORIGINS,
    )
  ) {
    errors.push("Expected the exact static and dynamic optional provider origins.");
  }
  if (manifest.host_permissions !== undefined) {
    errors.push("Expected no required host_permissions.");
  }
  if (
    !hasExactMembers(
      manifest.optional_permissions,
      EXPECTED_OPTIONAL_PERMISSIONS,
    )
  ) {
    errors.push('Expected optional_permissions to equal ["cookies", "scripting"].');
  }
  if (manifest.minimum_chrome_version !== "116") {
    errors.push('Expected minimum_chrome_version to equal "116".');
  }
  if (
    JSON.stringify(manifest.icons) !==
    JSON.stringify({
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    })
  ) {
    errors.push("Expected the complete extension icon set.");
  }
  if (
    typeof manifest.background?.service_worker !== "string" ||
    manifest.background.service_worker.length === 0
  ) {
    errors.push("Expected a background service worker.");
  }

  return errors;
}

export function validateSidePanelAssetText(text) {
  const errors = [];
  for (const boundary of SIDE_PANEL_CREDENTIAL_BOUNDARIES) {
    if (text.includes(boundary)) {
      errors.push(
        `Built side-panel assets contain forbidden background credential boundary: ${boundary}.`,
      );
    }
  }
  return errors;
}

export function validateReleaseTextEntries(entries) {
  const errors = [];
  const combinedText = Object.values(entries).join("\n");
  const lowerCombinedText = combinedText.toLowerCase();

  for (const literal of FORBIDDEN_RELEASE_LITERALS) {
    if (lowerCombinedText.includes(literal.toLowerCase())) {
      errors.push(`Release text contains forbidden literal: ${literal}.`);
    }
  }

  for (const [name, text] of Object.entries(entries)) {
    if (KEY_SHAPED_VALUE.test(text)) {
      errors.push(`Release text contains a key-shaped credential value in ${name}.`);
    }
  }

  return errors;
}

export function validateReleaseEntryNames(names) {
  const errors = [];

  for (const name of names) {
    const lower = String(name).toLowerCase();
    const components = String(name).split("/");
    let error;

    if (
      String(name).startsWith("/") ||
      String(name).startsWith("\\") ||
      /^[A-Za-z]:[\\/]/u.test(String(name))
    ) {
      error = `Release entry is absolute: ${name}.`;
    } else if (
      components.includes("..") ||
      components.includes(".") ||
      (components.includes("") && !String(name).endsWith("/"))
    ) {
      error = `Release entry contains traversal or an invalid segment: ${name}.`;
    } else if (String(name).includes("\\")) {
      error = `Release entry contains a non-portable path separator: ${name}.`;
    } else if (
      components.some(
        (component) => component.toLowerCase() === ".superpowers",
      ) ||
      lower === "docs/superpowers" ||
      lower.startsWith("docs/superpowers/")
    ) {
      error = `Release entry exposes Superpowers workflow files: ${name}.`;
    } else if (lower.endsWith(".map")) {
      error = `Release entry contains a source map: ${name}.`;
    } else if (components.some((component) => component.startsWith("."))) {
      error = `Release entry contains a dotfile: ${name}.`;
    } else if (
      /(?:^|\/)(?:release-evidence|test-results|playwright-report|coverage)(?:\/|$)/iu.test(
        String(name),
      ) ||
      /(?:^|\/)task-\d+-report\.md$/iu.test(String(name))
    ) {
      error = `Release entry contains generated evidence: ${name}.`;
    }

    if (error) errors.push(error);
  }
  return errors;
}

function findZipEndOfCentralDirectory(bytes, view) {
  const minimumOffset = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record is missing or invalid.");
}

function decodeZipEntryName(nameBytes, usesUtf8) {
  if (!usesUtf8 && nameBytes.some((byte) => byte > 0x7f)) {
    throw new Error("ZIP entry name uses an unsupported legacy encoding.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
  } catch {
    throw new Error("ZIP entry name is not valid UTF-8.");
  }
}

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_END_RECORD_SIGNATURE = 0x06064b50;
const ZIP64_END_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_SUPPORTED_FLAGS = ZIP_FLAG_UTF8;
const ZIP_SUPPORTED_METHODS = new Set([0, 8]);

function validateZipFlags(flags, name, location) {
  if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) {
    throw new Error(`Encrypted ZIP entries are unsupported: ${name}.`);
  }
  if ((flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
    throw new Error(`ZIP data descriptors are unsupported: ${name}.`);
  }
  if ((flags & ~ZIP_SUPPORTED_FLAGS) !== 0) {
    throw new Error(
      `ZIP entry has unsupported general-purpose flags in its ${location} header: ${name}.`,
    );
  }
}

function validateZipExtraFields(bytes, view, offset, length, location, name) {
  if (length === 0) return;
  const end = offset + length;
  if (end > bytes.length) {
    throw new Error(`ZIP ${location} extra fields exceed their bounds: ${name}.`);
  }
  let cursor = offset;
  let hasZip64 = false;
  while (cursor < end) {
    if (cursor + 4 > end) {
      throw new Error(`ZIP ${location} extra field is truncated: ${name}.`);
    }
    const headerId = view.getUint16(cursor, true);
    const dataLength = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (cursor + dataLength > end) {
      throw new Error(`ZIP ${location} extra field exceeds its bounds: ${name}.`);
    }
    if (headerId === 0x0001) hasZip64 = true;
    cursor += dataLength;
  }
  if (hasZip64) {
    throw new Error(`ZIP64 extra fields are unsupported: ${name}.`);
  }
  throw new Error(`ZIP ${location} extra fields are unsupported: ${name}.`);
}

function equalBytes(left, right) {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

export function readReleaseZipCentralDirectoryNames(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length < 22) throw new Error("ZIP archive is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEndOfCentralDirectory(bytes, view);
  if (
    endOffset >= 20 &&
    view.getUint32(endOffset - 20, true) === ZIP64_END_LOCATOR_SIGNATURE
  ) {
    throw new Error("ZIP64 end-of-central-directory locators are unsupported.");
  }
  if (
    endOffset >= 56 &&
    view.getUint32(endOffset - 56, true) === ZIP64_END_RECORD_SIGNATURE
  ) {
    throw new Error("ZIP64 end-of-central-directory records are unsupported.");
  }
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  const archiveCommentLength = view.getUint16(endOffset + 20, true);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    diskEntries !== totalEntries
  ) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 release archives are not supported.");
  }
  if (archiveCommentLength !== 0) {
    throw new Error("ZIP archive comments are unsupported.");
  }
  if (centralDirectoryOffset + centralDirectorySize !== endOffset) {
    throw new Error("ZIP central-directory bounds are invalid.");
  }

  const records = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (
      offset + 46 > endOffset ||
      view.getUint32(offset, true) !== 0x02014b50
    ) {
      throw new Error("ZIP central-directory entry is truncated or invalid.");
    }
    const versionNeeded = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > endOffset) {
      throw new Error("ZIP central-directory entry exceeds its bounds.");
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeZipEntryName(
      nameBytes,
      (flags & ZIP_FLAG_UTF8) !== 0,
    );
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      throw new Error(`ZIP64 per-entry sentinels are unsupported: ${name}.`);
    }
    if (diskStart !== 0) {
      throw new Error(`Multi-disk ZIP entries are unsupported: ${name}.`);
    }
    if (versionNeeded >= 45) {
      throw new Error(`ZIP64 entry versions are unsupported: ${name}.`);
    }
    if (versionNeeded > 20) {
      throw new Error(`ZIP entry requires an unsupported version: ${name}.`);
    }
    validateZipFlags(flags, name, "central");
    if (!ZIP_SUPPORTED_METHODS.has(method)) {
      throw new Error(
        `ZIP entry uses an unsupported compression method: ${name}.`,
      );
    }
    validateZipExtraFields(
      bytes,
      view,
      offset + 46 + nameLength,
      extraLength,
      "central",
      name,
    );
    if (commentLength !== 0) {
      throw new Error(`ZIP entry comments are unsupported: ${name}.`);
    }
    records.push({
      name,
      nameBytes,
      versionNeeded,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = nextOffset;
  }
  if (offset !== endOffset) {
    throw new Error("ZIP central-directory inventory is inconsistent.");
  }

  const names = records.map(({ name }) => name);
  const seenNames = new Set();
  for (const name of names) {
    if (seenNames.has(name)) {
      throw new Error(`Duplicate ZIP entry name: ${name}.`);
    }
    seenNames.add(name);
  }
  const unsafeName = validateReleaseEntryNames(names)[0];
  if (unsafeName) throw new Error(unsafeName);

  const seenLocalOffsets = new Set();
  const localSpans = [];
  for (const record of records) {
    if (seenLocalOffsets.has(record.localOffset)) {
      throw new Error(`Duplicate local-header offset: ${record.localOffset}.`);
    }
    seenLocalOffsets.add(record.localOffset);
    if (
      record.localOffset + 30 > centralDirectoryOffset ||
      record.localOffset + 30 > bytes.length
    ) {
      throw new Error(`ZIP local header exceeds its bounds: ${record.name}.`);
    }
    if (
      view.getUint32(record.localOffset, true) !== ZIP_LOCAL_HEADER_SIGNATURE
    ) {
      throw new Error(`ZIP local-header signature is invalid: ${record.name}.`);
    }
    const localVersionNeeded = view.getUint16(record.localOffset + 4, true);
    const localFlags = view.getUint16(record.localOffset + 6, true);
    const localMethod = view.getUint16(record.localOffset + 8, true);
    const localCrc = view.getUint32(record.localOffset + 14, true);
    const localCompressedSize = view.getUint32(record.localOffset + 18, true);
    const localUncompressedSize = view.getUint32(record.localOffset + 22, true);
    const localNameLength = view.getUint16(record.localOffset + 26, true);
    const localExtraLength = view.getUint16(record.localOffset + 28, true);
    if (
      localCompressedSize === 0xffffffff ||
      localUncompressedSize === 0xffffffff
    ) {
      throw new Error(
        `ZIP64 per-entry sentinels are unsupported: ${record.name}.`,
      );
    }
    const localNameOffset = record.localOffset + 30;
    const localExtraOffset = localNameOffset + localNameLength;
    const dataOffset = localExtraOffset + localExtraLength;
    if (
      localExtraOffset > centralDirectoryOffset ||
      dataOffset > centralDirectoryOffset ||
      dataOffset > bytes.length
    ) {
      throw new Error(`ZIP local header exceeds its bounds: ${record.name}.`);
    }
    const localNameBytes = bytes.subarray(
      localNameOffset,
      localNameOffset + localNameLength,
    );
    const localName = decodeZipEntryName(
      localNameBytes,
      (localFlags & ZIP_FLAG_UTF8) !== 0,
    );
    const unsafeLocalName = validateReleaseEntryNames([localName])[0];
    if (unsafeLocalName) throw new Error(`Local ZIP ${unsafeLocalName}`);
    validateZipFlags(localFlags, localName, "local");
    validateZipExtraFields(
      bytes,
      view,
      localExtraOffset,
      localExtraLength,
      "local",
      localName,
    );
    if (
      !equalBytes(localNameBytes, record.nameBytes) ||
      localName !== record.name
    ) {
      throw new Error(`ZIP local-central name mismatch: ${record.name}.`);
    }
    if (localVersionNeeded !== record.versionNeeded) {
      throw new Error(`ZIP local-central version mismatch: ${record.name}.`);
    }
    if (localFlags !== record.flags) {
      throw new Error(`ZIP local-central flags mismatch: ${record.name}.`);
    }
    if (localMethod !== record.method) {
      throw new Error(`ZIP local-central method mismatch: ${record.name}.`);
    }
    if (localCrc !== record.crc) {
      throw new Error(`ZIP local-central CRC mismatch: ${record.name}.`);
    }
    if (localCompressedSize !== record.compressedSize) {
      throw new Error(
        `ZIP local-central compressed size mismatch: ${record.name}.`,
      );
    }
    if (localUncompressedSize !== record.uncompressedSize) {
      throw new Error(
        `ZIP local-central uncompressed size mismatch: ${record.name}.`,
      );
    }
    if (
      record.method === 0 &&
      record.compressedSize !== record.uncompressedSize
    ) {
      throw new Error(`Stored ZIP entry sizes are inconsistent: ${record.name}.`);
    }
    const dataEnd = dataOffset + record.compressedSize;
    if (dataEnd > centralDirectoryOffset || dataEnd > bytes.length) {
      throw new Error(`ZIP compressed data exceeds its bounds: ${record.name}.`);
    }
    localSpans.push({
      start: record.localOffset,
      end: dataEnd,
      name: record.name,
    });
  }

  localSpans.sort((left, right) => left.start - right.start);
  for (let index = 0; index < localSpans.length; index += 1) {
    const current = localSpans[index];
    const expectedStart = index === 0 ? 0 : localSpans[index - 1].end;
    if (current.start < expectedStart) {
      throw new Error(`ZIP local entry spans overlap: ${current.name}.`);
    }
    if (current.start !== expectedStart) {
      throw new Error(`ZIP local entry layout contains an unsupported gap.`);
    }
  }
  const finalLocalEnd = localSpans.at(-1)?.end ?? 0;
  if (finalLocalEnd !== centralDirectoryOffset) {
    throw new Error("ZIP local entries do not end at the central directory.");
  }
  return names;
}

export function readValidatedReleaseZipEntries(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const rawNames = readReleaseZipCentralDirectoryNames(bytes);
  const entries = unzipSync(bytes);
  const decodedNames = Object.keys(entries);
  if (
    rawNames.length !== decodedNames.length ||
    rawNames.some((name) => !Object.hasOwn(entries, name))
  ) {
    throw new Error(
      "Decoded ZIP entries do not match the raw central-directory inventory.",
    );
  }
  return entries;
}

export function validateReleaseArtifactContents(entries) {
  const textEntries = Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      name,
      typeof value === "string" ? value : Buffer.from(value).toString("utf8"),
    ]),
  );
  const errors = validateReleaseTextEntries(textEntries);

  for (const [name, text] of Object.entries(textEntries)) {
    if (WORKSTATION_PATH.test(text)) {
      errors.push(`Release file contains a workstation path in ${name}.`);
    }
    if (text.includes(".superpowers") || text.includes("docs/superpowers/")) {
      errors.push(`Release file exposes a Superpowers workflow path in ${name}.`);
    }
  }
  return errors;
}

function compareReleaseEntries(reference, candidate, candidateLabel) {
  const errors = [];
  const referenceNames = Object.keys(reference).sort();
  const candidateNames = Object.keys(candidate).sort();

  for (const name of referenceNames) {
    if (!(name in candidate)) {
      errors.push(`${candidateLabel} is missing WXT output file ${name}.`);
    } else if (
      !Buffer.from(candidate[name]).equals(Buffer.from(reference[name]))
    ) {
      errors.push(`${candidateLabel} bytes differ from WXT output for ${name}.`);
    }
  }
  for (const name of candidateNames) {
    if (!(name in reference)) {
      errors.push(
        `${candidateLabel} has unexpected file ${name} compared with WXT output.`,
      );
    }
  }
  return errors;
}

export function validateReleaseArtifactParity({ zip, output, dist }) {
  const errors = [];
  for (const entries of [zip, output, dist].filter(Boolean)) {
    errors.push(...validateReleaseEntryNames(Object.keys(entries)));
    errors.push(...validateReleaseArtifactContents(entries));
  }
  if (zip) errors.push(...compareReleaseEntries(output, zip, "ZIP"));
  errors.push(...compareReleaseEntries(output, dist, "Staged unpacked"));
  return errors;
}

export async function readReleaseDirectoryEntries(root) {
  const entries = {};

  async function visit(directory, relativeDirectory = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativeName = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absoluteName = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absoluteName, relativeName);
      } else if (entry.isFile()) {
        entries[relativeName] = await readFile(absoluteName);
      } else {
        throw new Error(
          `Release tree contains a non-regular entry: ${relativeName}.`,
        );
      }
    }
  }

  await visit(path.resolve(root));
  return entries;
}
