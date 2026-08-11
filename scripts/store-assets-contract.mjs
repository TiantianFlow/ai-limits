import { PNG } from "pngjs";

export const REQUIRED_STORE_ASSET_DIMENSIONS = {
  "screenshot-overview-1280x800.png": [1280, 800],
  "screenshot-pacing-1280x800.png": [1280, 800],
  "screenshot-privacy-1280x800.png": [1280, 800],
  "small-promo-440x280.png": [440, 280],
  "zh_CN/screenshot-overview-1280x800.png": [1280, 800],
  "zh_CN/screenshot-pacing-1280x800.png": [1280, 800],
  "zh_CN/screenshot-privacy-1280x800.png": [1280, 800],
};

export function readPngDimensions(buffer) {
  const png = PNG.sync.read(buffer, { checkCRC: true });

  return {
    width: png.width,
    height: png.height,
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
