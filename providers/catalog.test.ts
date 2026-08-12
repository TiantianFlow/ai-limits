import { describe, expect, test } from "vitest";

import { isRuntimeCommand } from "../background/messages";
import * as catalog from "./catalog";
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
  test("provides complete local presentation metadata for every supported provider", () => {
    type Presentation = {
      markPath: string;
      darkMarkPath?: string;
      connectionLabel: string;
      connectionDisclosure: string;
      capabilities: readonly string[];
      manualRefreshDisclosure?: string;
    };
    const providerPresentation = (
      catalog as typeof catalog & {
        providerPresentation?: (providerId: (typeof providerIds)[number]) => Presentation;
      }
    ).providerPresentation;

    expect(providerPresentation).toBeTypeOf("function");
    if (!providerPresentation) return;

    expect(
      providerIds.map((providerId) => ({
        providerId,
        ...providerPresentation(providerId),
      })),
    ).toEqual([
      {
        providerId: "chatgpt",
        markPath: "/provider-marks/chatgpt.svg",
        connectionLabel: "Connect ChatGPT",
        connectionDisclosure:
          "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
        capabilities: ["Message limits", "Credits"],
      },
      {
        providerId: "claude",
        markPath: "/provider-marks/claude.svg",
        connectionLabel: "Connect Claude",
        connectionDisclosure:
          "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
        capabilities: ["Message limits", "Extra usage"],
      },
      {
        providerId: "kimi",
        markPath: "/provider-marks/kimi.svg",
        darkMarkPath: "/provider-marks/kimi-dark.svg",
        connectionLabel: "Connect Kimi",
        connectionDisclosure:
          "With permission, AI Limits may read the exact value of Kimi's signed-in kimi-auth cookie or the page's localStorage.access_token on kimi.com. It stores normalized usage locally, not the credential.",
        capabilities: ["Subscription usage", "Coding limits"],
        manualRefreshDisclosure:
          "Connect and manual Refresh may briefly open one inactive Kimi tab when recovery is needed. Scheduled or automatic refresh never opens a tab.",
      },
      {
        providerId: "cursor",
        markPath: "/provider-marks/cursor.svg",
        darkMarkPath: "/provider-marks/cursor-dark.svg",
        connectionLabel: "Connect Cursor",
        connectionDisclosure:
          "Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.",
        capabilities: ["Monthly usage", "On-demand spend"],
      },
    ]);
  });

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
