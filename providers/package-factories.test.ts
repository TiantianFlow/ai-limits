import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../domain/instances";
import {
  createApiKeyPackage,
  createBrowserSessionPackage,
} from "./package-factories";
import type { CollectionContext, ProviderAdapter } from "./types";

const services = {
  fetch: globalThis.fetch,
  now: 1_700_000_000_000,
  signal: new AbortController().signal,
  interaction: "forbidden" as const,
};

function instance(
  providerKind: ProviderInstanceRecord["providerKind"],
  config: ProviderInstanceRecord["config"],
  id = `${providerKind}:default`,
): ProviderInstanceRecord {
  return {
    id,
    providerKind,
    config,
    access: "granted",
    createdAt: 1,
    history: [],
  };
}

describe("provider package factories", () => {
  test("passes only generic request inputs to a fixed browser-session adapter", async () => {
    const collect = vi.fn(async (_context: CollectionContext) => ({
      ok: false as const,
      health: { kind: "signed_out" as const },
    }));
    const adapter: ProviderAdapter<"chatgpt"> = { id: "chatgpt", collect };
    const providerPackage = createBrowserSessionPackage({
      kind: "chatgpt",
      adapter,
    });

    await providerPackage.collect(
      instance("chatgpt", { kind: "fixed" }),
      services,
    );

    expect(collect).toHaveBeenCalledWith({
      fetch: globalThis.fetch,
      now: 1_700_000_000_000,
      signal: services.signal,
    });
  });

  test("returns signed out without calling an API-key adapter when the credential is missing", async () => {
    const collect = vi.fn();
    const providerPackage = createApiKeyPackage({
      kind: "elevenlabs",
      adapter: { id: "elevenlabs", collect },
    });

    await expect(
      providerPackage.collect(
        instance("elevenlabs", { kind: "fixed" }),
        services,
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(collect).not.toHaveBeenCalled();
  });

  test("keeps same-origin New API configuration separate from independent keys", async () => {
    const seen: CollectionContext[] = [];
    const providerPackage = createApiKeyPackage({
      kind: "newapi",
      adapter: {
        id: "newapi",
        collect: async (context) => {
          seen.push(context);
          return { ok: false, health: { kind: "provider_changed" } };
        },
      },
    });
    const config = {
      kind: "dynamic-origin" as const,
      baseUrl: "https://relay.example",
    };

    await providerPackage.collect(
      instance("newapi", config, "newapi:550e8400-e29b-41d4-a716-446655440000"),
      services,
      { kind: "api-key", value: "first-key" },
    );
    await providerPackage.collect(
      instance("newapi", config, "newapi:550e8400-e29b-41d4-a716-446655440001"),
      services,
      { kind: "api-key", value: "second-key" },
    );

    expect(seen).toEqual([
      expect.objectContaining({
        credential: { kind: "api-key", value: "first-key" },
        baseUrl: "https://relay.example",
      }),
      expect.objectContaining({
        credential: { kind: "api-key", value: "second-key" },
        baseUrl: "https://relay.example",
      }),
    ]);
    expect(seen[0]?.credential).not.toHaveProperty("baseUrl");
    expect(seen[1]?.credential).not.toHaveProperty("baseUrl");
  });
});
