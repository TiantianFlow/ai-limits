import { describe, expect, it } from "vitest";
import {
  readPngDimensions,
  validateStoreAssetDimensions,
} from "./store-assets-contract.mjs";

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe("store assets", () => {
  it("reads PNG IHDR dimensions", () => {
    expect(readPngDimensions(pngHeader(1280, 800))).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("rejects a wrong screenshot size", () => {
    const errors = validateStoreAssetDimensions({
      "screenshot-overview-1280x800.png": { width: 640, height: 400 },
    });
    expect(errors).toContain(
      "screenshot-overview-1280x800.png must be 1280x800.",
    );
  });
});
