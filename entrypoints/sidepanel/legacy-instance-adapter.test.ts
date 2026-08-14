import { describe, expect, test } from "vitest";

import type { AppViewState } from "../../background/view-state";
import {
  projectLegacyInstanceOperations,
  projectLegacyInstanceState,
} from "./legacy-instance-adapter";

function view(instances: AppViewState["instances"]): AppViewState {
  return {
    preferences: { displayMode: "used", autoRefresh: true },
    instances,
  };
}

describe("Task 6-only legacy instance adapter", () => {
  test("projects one instance per provider kind into the unchanged Cockpit contract", () => {
    const projection = projectLegacyInstanceState(
      view([
        {
          id: "kimi:default",
          providerKind: "kimi",
          access: "granted",
          createdAt: 1,
          history: [],
        },
        {
          id: "newapi:550e8400-e29b-41d4-a716-446655440000",
          providerKind: "newapi",
          userLabel: "Relay",
          origin: "https://relay.example",
          access: "required",
          createdAt: 2,
          history: [],
        },
      ]),
    );

    expect(projection.state).toEqual({
      version: 4,
      preferences: { displayMode: "used", autoRefresh: true },
      providers: [
        { providerId: "kimi", access: "granted", history: [] },
        { providerId: "newapi", access: "required", history: [] },
      ],
    });
    expect(projection.instanceIds).toEqual({
      kimi: "kimi:default",
      newapi: "newapi:550e8400-e29b-41d4-a716-446655440000",
    });
  });

  test("rejects duplicate provider kinds instead of hiding a sibling", () => {
    expect(() =>
      projectLegacyInstanceState(
        view([
          {
            id: "newapi:550e8400-e29b-41d4-a716-446655440000",
            providerKind: "newapi",
            access: "granted",
            createdAt: 1,
            history: [],
          },
          {
            id: "newapi:550e8400-e29b-41d4-a716-446655440001",
            providerKind: "newapi",
            access: "granted",
            createdAt: 2,
            history: [],
          },
        ]),
      ),
    ).toThrow("Legacy Cockpit cannot project duplicate provider kinds.");
  });

  test("does not expose origin, label, or instance identity through the V4 state object", () => {
    const projection = projectLegacyInstanceState(
      view([
        {
          id: "newapi:550e8400-e29b-41d4-a716-446655440000",
          providerKind: "newapi",
          userLabel: "Secret-ish local label",
          origin: "https://relay.example",
          access: "granted",
          createdAt: 1,
          history: [],
        },
      ]),
    );

    expect(JSON.stringify(projection.state)).not.toContain("relay.example");
    expect(JSON.stringify(projection.state)).not.toContain("Secret-ish");
    expect(JSON.stringify(projection.state)).not.toContain("550e8400");
  });

  test("translates instance-keyed operations only at the Task 6 boundary and rejects sibling collapse", () => {
    expect(
      projectLegacyInstanceOperations({
        "kimi:default": "waiting_for_session",
        "newapi:550e8400-e29b-41d4-a716-446655440000": "fetching",
      }),
    ).toEqual({ kimi: "waiting_for_session", newapi: "fetching" });

    expect(() =>
      projectLegacyInstanceOperations({
        "newapi:550e8400-e29b-41d4-a716-446655440000": "fetching",
        "newapi:550e8400-e29b-41d4-a716-446655440001":
          "requesting_permission",
      }),
    ).toThrow("Legacy Cockpit cannot project duplicate provider operations.");
  });
});
