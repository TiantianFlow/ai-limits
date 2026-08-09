import { describe, expect, test } from "vitest";

import { retryAtFromResponse } from "./retry-after";

const NOW = Date.UTC(2026, 7, 9, 12);

describe("Retry-After parsing", () => {
  test("parses non-negative delta seconds", () => {
    const response = new Response(undefined, {
      status: 429,
      headers: { "Retry-After": "120" },
    });

    expect(retryAtFromResponse(response, NOW)).toBe(NOW + 120_000);
  });

  test("parses a future HTTP date", () => {
    const retryAt = NOW + 90_000;
    const response = new Response(undefined, {
      status: 503,
      headers: { "Retry-After": new Date(retryAt).toUTCString() },
    });

    expect(retryAtFromResponse(response, NOW)).toBe(retryAt);
  });

  test.each(["", "-1", "NaN", "yesterday"])(
    "rejects unsafe Retry-After value %j",
    (value) => {
      const response = new Response(undefined, {
        status: 429,
        headers: { "Retry-After": value },
      });

      expect(retryAtFromResponse(response, NOW)).toBeUndefined();
    },
  );
});
