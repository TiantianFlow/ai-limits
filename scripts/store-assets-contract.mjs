const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

export const REQUIRED_STORE_ASSET_DIMENSIONS = {
  "screenshot-overview-1280x800.png": [1280, 800],
  "screenshot-pacing-1280x800.png": [1280, 800],
  "screenshot-privacy-1280x800.png": [1280, 800],
  "small-promo-440x280.png": [440, 280],
};

export function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error("PNG data is too short to contain an IHDR chunk.");
  }

  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("File does not have a valid PNG signature.");
  }

  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG does not begin with an IHDR chunk.");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function validateStoreAssetDimensions(assets) {
  const errors = [];

  for (const [name, [requiredWidth, requiredHeight]] of Object.entries(
    REQUIRED_STORE_ASSET_DIMENSIONS,
  )) {
    const dimensions = assets[name];

    if (!dimensions) {
      errors.push(`${name} is missing.`);
      continue;
    }

    if (
      dimensions.width !== requiredWidth ||
      dimensions.height !== requiredHeight
    ) {
      errors.push(`${name} must be ${requiredWidth}x${requiredHeight}.`);
    }
  }

  return errors;
}
