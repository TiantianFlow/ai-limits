import { describe, expect, it } from "vitest";

import type { AppViewState } from "../../domain/public-protocol";
import { parseAppViewState } from "../../domain/public-protocol";
import { finalizeFidelityViewState } from "./fidelity-state";

const state: AppViewState = {
  preferences: { displayMode: "used", autoRefresh: true },
  instances: [
    {
      id: "newapi:11111111-1111-4111-8111-111111111111",
      providerKind: "newapi",
      userLabel: "Personal relay",
      baseUrl: "https://relay.example/gateway",
      origin: "https://relay.example",
      access: "granted",
      createdAt: 1,
      history: [],
      snapshot: {
        providerKind: "newapi",
        accountLabel: "Relay account",
        source: "api-key",
        fetchedAt: 1,
        metrics: [],
      },
    },
  ],
};

describe("finalizeFidelityViewState", () => {
  it("omits collision labels instead of creating parser-invalid undefined fields", () => {
    const finalized = finalizeFidelityViewState(state, "unlabeled-collision");
    const instance = finalized.instances[0]!;

    expect(Object.hasOwn(instance, "userLabel")).toBe(false);
    expect(Object.hasOwn(instance.snapshot!, "accountLabel")).toBe(false);
    expect(parseAppViewState(finalized)).toEqual(finalized);
  });

  it("rejects any parser-unreachable preview state before render", () => {
    const invalid = {
      ...state,
      instances: [{ ...state.instances[0]!, userLabel: undefined }],
    } as AppViewState;

    expect(() => finalizeFidelityViewState(invalid, "default")).toThrow(
      "Missing application state",
    );
  });
});
