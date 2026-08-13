import { describe, expect, test } from "vitest";

import type { CollectionContext } from "./types";

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
});
