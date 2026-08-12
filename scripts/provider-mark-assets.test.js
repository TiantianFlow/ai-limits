import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const expectedKimiFrames = {
  "kimi.svg": "43eff2012c78452ead821b55defc7beaeae8265e79be30c7790254c7a8a1d650",
  "kimi-dark.svg": "5e5af92ba01ee2d26e89fdb11ac789cc4af1e0dcbb2408d705aaa360ea41bb09",
};

describe("provider mark assets", () => {
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
