import { describe, expect, it } from "vitest";

import { parseAppViewState } from "../../domain/public-protocol";
import {
  createFidelityScenario,
  FIDELITY_FIXED_CLOCK,
  type FidelityRequest,
  type FidelityScreen,
  type FidelityState,
  type PreviewView,
} from "./copy";
import {
  createFidelityPreviewState,
  createStorePreviewState,
  updatePreviewState,
} from "./preview-state";

const now = Date.parse(FIDELITY_FIXED_CLOCK);
const storeViews: PreviewView[] = [
  "overview",
  "pacing",
  "history",
  "privacy",
  "promo",
  "social",
];
const fidelityScreens: FidelityScreen[] = [
  "first-run",
  "overview",
  "provider-detail",
  "history",
  "add-provider",
  "settings",
  "api-key-connect",
];
const fidelityStates: FidelityState[] = [
  "default",
  "refresh-pending",
  "partial-refresh",
  "kimi-interaction",
  "delete-confirmation",
  "unlabeled-collision",
  "rename-failure",
];

function request(screen: FidelityScreen, state: FidelityState): FidelityRequest {
  return {
    screen,
    state,
    mode: "used",
    theme: "light",
    panelWidth: 400,
    dataSource: "fixture",
    fixedClock: FIDELITY_FIXED_CLOCK,
    locale: "en-US",
    now,
  };
}

describe("preview view state", () => {
  it.each(storeViews)(
    "builds the ordinary %s store preview through the public parser",
    (view) => {
      const state = createStorePreviewState(
        new URLSearchParams({ view }),
        now,
      );

      expect(parseAppViewState(state)).toEqual(state);
    },
  );

  it.each(
    fidelityScreens.flatMap((screen) =>
      fidelityStates.map((state) => [screen, state] as const),
    ),
  )(
    "builds the %s/%s fidelity scenario through the public parser",
    (screen, state) => {
      const fidelityRequest = request(screen, state);
      const previewState = createFidelityPreviewState(
        fidelityRequest,
        createFidelityScenario(fidelityRequest),
      );

      expect(parseAppViewState(previewState)).toEqual(previewState);
    },
  );

  it("validates display, refresh-status, disconnect, and rename updates", () => {
    const initial = createFidelityPreviewState(
      request("settings", "default"),
      createFidelityScenario(request("settings", "default")),
    );
    const workId = "newapi:22222222-2222-4222-8222-222222222222";
    const updated = updatePreviewState(initial, (current) => ({
      ...current,
      preferences: { ...current.preferences, displayMode: "left", autoRefresh: false },
      instances: current.instances.map((instance) => {
        if (instance.id === "kimi:default") {
          return {
            ...instance,
            lastAttempt: {
              trigger: "manual_provider",
              startedAt: now,
              finishedAt: now + 1,
              outcome: { kind: "deferred", reason: "session_required" },
            },
          };
        }
        if (instance.id === workId) {
          const { snapshot: _snapshot, ...disconnected } = instance;
          return {
            ...disconnected,
            userLabel: "Renamed work relay",
            access: "required" as const,
            history: [],
          };
        }
        return instance;
      }),
    }));

    const work = updated.instances.find((instance) => instance.id === workId)!;
    expect(updated.preferences).toEqual({ displayMode: "left", autoRefresh: false });
    expect(work.userLabel).toBe("Renamed work relay");
    expect(Object.hasOwn(work, "snapshot")).toBe(false);
    expect(parseAppViewState(updated)).toEqual(updated);
  });

  it("rejects an invalid preview interaction update instead of repairing it", () => {
    const initial = createStorePreviewState(new URLSearchParams(), now);

    expect(() =>
      updatePreviewState(initial, (current) => ({
        ...current,
        instances: [{ ...current.instances[0]!, userLabel: undefined }],
      })),
    ).toThrow("Missing application state");
  });
});
