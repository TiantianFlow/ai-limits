import { describe, expect, test } from "vitest";

import type { ProviderInstanceRecord } from "../domain/model";
import type {
  CollectionContext,
  ProviderPackage,
  ProviderRuntimeServices,
} from "./types";

const apiKeyCollectionContext = {
  fetch: globalThis.fetch,
  now: 1_700_000_000_000,
  signal: new AbortController().signal,
  credential: { kind: "api-key", value: "ephemeral-api-key" },
} satisfies CollectionContext;

describe("provider collection context", () => {
  test("carries an ephemeral API-key credential to an adapter", () => {
    expect(apiKeyCollectionContext.credential).toEqual({
      kind: "api-key",
      value: "ephemeral-api-key",
    });
  });

  test("contains only raw adapter request inputs", () => {
    const context: CollectionContext = {
      fetch: globalThis.fetch,
      now: 1_700_000_000_000,
      signal: new AbortController().signal,
      accessToken: "ephemeral-provider-token",
    };

    expect(context).toEqual({
      fetch: globalThis.fetch,
      now: 1_700_000_000_000,
      signal: context.signal,
      accessToken: "ephemeral-provider-token",
    });
  });

  test("defines instance-oriented provider packages", async () => {
    const instance: ProviderInstanceRecord = {
      id: "chatgpt:default",
      providerKind: "chatgpt",
      config: { kind: "fixed" },
      access: "granted",
      createdAt: 1,
      history: [],
    };
    const services: ProviderRuntimeServices = {
      fetch: globalThis.fetch,
      now: 2,
      signal: new AbortController().signal,
      interaction: "forbidden",
    };
    const packageDefinition: ProviderPackage = {
      kind: "chatgpt",
      cardinality: "single",
      credentialKind: "none",
      normalizeConfig: () => ({ kind: "fixed" }),
      requiredPermissions: () => ({ origins: ["https://chatgpt.com/*"] }),
      collect: async () => ({
        ok: false,
        deferred: { reason: "session_required" },
      }),
    };

    await expect(packageDefinition.collect(instance, services)).resolves.toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
  });
});
