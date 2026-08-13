import { describe, expect, test } from "vitest";

import { createInitialState, migrateState, normalizeProviderSnapshot } from "./initial-state";

const snapshot = {
  providerId: "elevenlabs",
  source: "api-key",
  fetchedAt: 1_700_000_000_000,
  windows: [],
  credits: [],
};

describe("persisted provider snapshots", () => {
  test("accepts API-key snapshots from known providers", () => {
    expect(normalizeProviderSnapshot(snapshot, "elevenlabs")).toEqual(snapshot);
  });

  test("rejects unknown snapshot sources", () => {
    expect(
      normalizeProviderSnapshot({ ...snapshot, source: "unknown" }, "elevenlabs"),
    ).toBeUndefined();
  });
});

describe("persisted credential failures", () => {
  test.each([
    [
      "credential_invalid",
      "The API key is invalid. Enter a valid key and try again.",
    ],
    [
      "credential_scope_required",
      "The API key cannot read usage. Update its permissions and try again.",
    ],
  ] as const)("normalizes %s to its fixed sanitized message", (category, message) => {
    const state = createInitialState();
    state.providers[4] = {
      ...state.providers[4]!,
      access: "granted",
      lastAttempt: {
        trigger: "manual_provider",
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_001_000,
        outcome: {
          kind: "failure",
          category,
          message: `provider body with secret: ${category}`,
        },
      },
    };

    expect(migrateState(state, 1_700_000_001_000).providers[4]?.lastAttempt)
      .toEqual({
        trigger: "manual_provider",
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_001_000,
        outcome: { kind: "failure", category, message },
      });
  });
});
