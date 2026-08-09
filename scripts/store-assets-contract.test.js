import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import {
  readPngDimensions,
  validateStoreAssetDimensions,
} from "./store-assets-contract.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodedPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  const pixels = Buffer.alloc((width * 4 + 1) * height);

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("store assets", () => {
  it("reads dimensions from a fully encoded PNG", () => {
    expect(readPngDimensions(encodedPng(1280, 800))).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("rejects malformed, truncated, CRC-corrupt, and missing-IEND PNGs", () => {
    const valid = encodedPng(1280, 800);
    const badCrc = Buffer.from(valid);
    badCrc[16] ^= 1;

    expect(() => readPngDimensions(Buffer.from("not a PNG"))).toThrow();
    expect(() => readPngDimensions(valid.subarray(0, 33))).toThrow();
    expect(() => readPngDimensions(badCrc)).toThrow();
    expect(() => readPngDimensions(valid.subarray(0, -12))).toThrow();
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
