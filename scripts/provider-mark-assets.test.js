import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const expectedKimiFrames = {
  "kimi.svg": "43eff2012c78452ead821b55defc7beaeae8265e79be30c7790254c7a8a1d650",
  "kimi-dark.svg": "5e5af92ba01ee2d26e89fdb11ac789cc4af1e0dcbb2408d705aaa360ea41bb09",
};
const expectedElevenLabsPathHash =
  "168dc1d3ed5c2e7ff3df491f467a3a7d15d997ecefa1d6d17e65a3538a91f47b";

function readElevenLabsSvg() {
  return readFileSync(
    path.join(process.cwd(), "public", "provider-marks", "elevenlabs.svg"),
    "utf8",
  );
}

describe("provider mark assets", () => {
  it("keeps the exact official ElevenLabs path geometry", () => {
    const paths = readElevenLabsSvg().match(/<path\b[^>]*\/>/gu);

    expect(paths).toHaveLength(2);
    expect(createHash("sha256").update(paths.join("\n")).digest("hex")).toBe(
      expectedElevenLabsPathHash,
    );
  });

  it("normalizes the ElevenLabs visual bounds inside a square viewport", () => {
    const viewBox = readElevenLabsSvg()
      .match(/\bviewBox="([^"]+)"/u)?.[1]
      .split(/\s+/u)
      .map(Number);
    expect(viewBox).toHaveLength(4);

    const [minX, minY, width, height] = viewBox;
    const officialSymbolBounds = {
      minX: 348,
      minY: 292,
      maxX: 528,
      maxY: 584,
    };

    expect({
      width,
      height,
      insetTop: officialSymbolBounds.minY - minY,
      insetRight: minX + width - officialSymbolBounds.maxX,
      insetBottom: minY + height - officialSymbolBounds.maxY,
      insetLeft: officialSymbolBounds.minX - minX,
    }).toEqual({
      width: 292,
      height: 292,
      insetTop: 0,
      insetRight: 56,
      insetBottom: 0,
      insetLeft: 56,
    });
  });

  it.each(Object.entries(expectedKimiFrames))(
    "keeps the official 48px Kimi pixels in %s",
    (fileName, expectedPixelHash) => {
      const svg = readFileSync(
        path.join(process.cwd(), "public", "provider-marks", fileName),
        "utf8",
      );
      const encodedPng = svg.match(/base64,([^\"]+)/)?.[1];
      expect(encodedPng).toBeDefined();

      const png = PNG.sync.read(Buffer.from(encodedPng, "base64"), {
        checkCRC: true,
      });
      expect([png.width, png.height]).toEqual([48, 48]);
      expect(createHash("sha256").update(png.data).digest("hex")).toBe(
        expectedPixelHash,
      );
    },
  );
});
