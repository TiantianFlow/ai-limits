import { describe, expect, it } from "vitest";

import {
  validateReleaseTextEntries,
} from "./artifact-contract.mjs";

const knownSyntheticCredentialLiterals = [
  "active-test-key",
  "candidate-key",
  "deferred-candidate-key",
  "ephemeral-api-key",
  "latest-key",
  "must-never-escape",
  "new-candidate-key",
  "not-a-real-elevenlabs-key",
  "old-key",
  "prior-active-key",
  "rejected-test-key",
  "replacement-key",
  "saved-key",
  "synthetic-api-key",
  "synthetic-candidate-key",
];

describe("release ZIP credential scan", () => {
  it("accepts product prose and code-level header names without a value", () => {
    expect(
      validateReleaseTextEntries({
        "background.js":
          'const headerName="xi-api-key"; const endpoint="https://api.elevenlabs.io/v1/user/subscription";',
        "sidepanel.html": "Create and validate an ElevenLabs API key.",
      }),
    ).toEqual([]);
  });

  it.each(knownSyntheticCredentialLiterals)(
    "rejects known synthetic credential literal %s from release text",
    (literal) => {
      expect(validateReleaseTextEntries({ "background.js": literal })).toContain(
        `Release text contains synthetic credential literal: ${literal}.`,
      );
    },
  );

  it("rejects key-shaped values without treating ordinary API-key prose as a secret", () => {
    expect(
      validateReleaseTextEntries({
        "background.js": `const leaked = "sk_${"a".repeat(40)}";`,
      }),
    ).toContain(
      "Release text contains a key-shaped credential value in background.js.",
    );
    expect(
      validateReleaseTextEntries({
        "sidepanel.html": "Your API key is stored locally after validation.",
      }),
    ).toEqual([]);
  });
});
