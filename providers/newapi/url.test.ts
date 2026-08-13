import { describe, expect, it } from "vitest";

import {
  newApiPermissionOrigin,
  normalizeNewApiBaseUrl,
} from "./url";

describe("normalizeNewApiBaseUrl", () => {
  it.each([
    ["https://api.example.com", "https://api.example.com"],
    ["https://api.example.com/console", "https://api.example.com"],
    ["https://api.example.com/v1", "https://api.example.com"],
    ["https://api.example.com/v1/messages", "https://api.example.com"],
    ["https://api.example.com/api/usage/token/", "https://api.example.com"],
    ["https://api.example.com/new-api/v1/chat/completions", "https://api.example.com/new-api"],
    [" https://API.EXAMPLE.COM:443/new-api/console/?tab=keys#usage ", "https://api.example.com/new-api"],
    ["http://localhost:3000/v1", "http://localhost:3000"],
    ["http://127.0.0.1:3000/api/usage/token", "http://127.0.0.1:3000"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeNewApiBaseUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "api.example.com",
    "http://api.example.com",
    "ftp://api.example.com",
    "https://user:password@api.example.com",
    "https://*.example.com",
    `https://example.com/${"x".repeat(2_100)}`,
  ])("rejects unsafe or ambiguous input %s", (input) => {
    expect(normalizeNewApiBaseUrl(input)).toBeUndefined();
  });

  it("creates the exact runtime host permission for the normalized instance", () => {
    expect(newApiPermissionOrigin("https://api.example.com/new-api/v1")).toBe(
      "https://api.example.com/*",
    );
    expect(newApiPermissionOrigin("http://localhost:3000/v1")).toBe(
      "http://localhost:3000/*",
    );
  });
});
