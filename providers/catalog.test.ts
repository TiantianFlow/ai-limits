import { describe, expect, test } from "vitest";

import { isRuntimeCommand } from "../background/messages";
import {
  assertProviderCatalogPermissionSafety,
  isProviderId,
  providerCatalog,
  providerIds,
  providerNames,
} from "./catalog";
import { createInitialState } from "./initial-state";
import { providerRegistry } from "./registry";

describe("provider catalog", () => {
  test("is the ordered source of provider identity, names, and permissions", () => {
    expect(providerIds).toEqual(["chatgpt", "claude", "kimi", "cursor"]);
    expect(
      providerIds.map((providerId) => ({
        providerId,
        name: providerNames[providerId],
        origins: providerCatalog[providerId].optionalOrigins,
        permissions: providerCatalog[providerId].optionalPermissions,
      })),
    ).toEqual([
      {
        providerId: "chatgpt",
        name: "ChatGPT",
        origins: ["https://chatgpt.com/*"],
        permissions: [],
      },
      {
        providerId: "claude",
        name: "Claude",
        origins: ["https://claude.ai/*"],
        permissions: [],
      },
      {
        providerId: "kimi",
        name: "Kimi",
        origins: ["https://www.kimi.com/*"],
        permissions: ["cookies", "scripting"],
      },
      {
        providerId: "cursor",
        name: "Cursor",
        origins: ["https://cursor.com/*"],
        permissions: [],
      },
    ]);
  });

  test("keeps registry, initial state, and runtime commands catalog-complete", () => {
    expect(Object.keys(providerRegistry)).toEqual(providerIds);
    expect(
      providerIds.map((providerId) => providerRegistry[providerId].id),
    ).toEqual(providerIds);
    expect(
      createInitialState().providers.map(({ providerId }) => providerId),
    ).toEqual(providerIds);
    expect(
      providerIds.every((providerId) =>
        isRuntimeCommand({ type: "COLLECT_PROVIDER", providerId }),
      ),
    ).toBe(true);
  });

  test("rejects unknown and non-string provider identifiers", () => {
    expect(isProviderId("chatgpt")).toBe(true);
    expect(isProviderId("antigravity")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
    expect(isProviderId({ providerId: "chatgpt" })).toBe(false);
  });

  test("keeps optional origins exact so shared access can be revoked safely", () => {
    expect(() =>
      assertProviderCatalogPermissionSafety(providerCatalog),
    ).not.toThrow();

    expect(() =>
      assertProviderCatalogPermissionSafety({
        sample: {
          optionalOrigins: ["https://*.example.com/*"],
        },
      }),
    ).toThrow(/exact HTTPS host/);

    expect(() =>
      assertProviderCatalogPermissionSafety({
        sample: {
          optionalOrigins: ["https://example.com?scope=all/*"],
        },
      }),
    ).toThrow(/exact HTTPS host/);

    expect(() =>
      assertProviderCatalogPermissionSafety({
        sample: {
          optionalOrigins: ["https://example.com:8443/*"],
        },
      }),
    ).toThrow(/exact HTTPS host/);
  });
});
