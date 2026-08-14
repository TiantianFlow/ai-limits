import { describe, expect, it } from "vitest";

import {
  parseAppViewState,
  type AppViewState,
} from "../../domain/public-protocol";
import {
  createFidelityScenario,
  FIDELITY_FIXED_CLOCK,
  type FidelityRequest,
  type FidelityScreen,
  type FidelityState,
  type PreviewView,
} from "./copy";
import {
  applyFidelityPreviewTransition,
  createFidelityPreviewState,
  createStorePreviewState,
  type FidelityPreviewTransition,
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

  it("shows two clearly labeled nonpersonal same-origin New API instances", () => {
    const state = createStorePreviewState(new URLSearchParams(), now);
    const newApiInstances = state.instances.filter(
      ({ providerKind }) => providerKind === "newapi",
    );

    expect(newApiInstances).toHaveLength(2);
    expect(newApiInstances.map(({ userLabel }) => userLabel)).toEqual([
      "Demo relay A",
      "Demo relay B",
    ]);
    expect(new Set(newApiInstances.map(({ origin }) => origin))).toEqual(
      new Set(["https://relay.example"]),
    );
    expect(
      newApiInstances.map(({ snapshot }) => {
        const quota = snapshot?.metrics.find(
          (metric) => metric.type === "quota" && metric.id === "relay-key-quota",
        );
        if (
          !quota ||
          quota.type !== "quota" ||
          quota.used === undefined ||
          quota.limit === undefined
        ) {
          throw new Error("missing absolute New API quota fixture");
        }
        return {
          usedRatio: quota.usedRatio,
          absoluteRatio: quota.used / quota.limit,
        };
      }),
    ).toEqual([
      { usedRatio: 0.25, absoluteRatio: 0.25 },
      { usedRatio: 0.43, absoluteRatio: 0.43 },
    ]);
    expect(newApiInstances.map(({ userLabel }) => userLabel).join(" ")).not.toMatch(
      /personal|work|@/i,
    );
  });

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

  it("applies the exact fidelity callback transitions through the public parser", () => {
    const initial = createFidelityPreviewState(
      request("settings", "default"),
      createFidelityScenario(request("settings", "default")),
    );
    const workId = "newapi:22222222-2222-4222-8222-222222222222";

    const refreshed = applyFidelityPreviewTransition(initial, {
      type: "refresh-status",
      instanceId: workId,
    });
    const disconnected = applyFidelityPreviewTransition(initial, {
      type: "disconnect",
      instanceId: workId,
    });
    const renamed = applyFidelityPreviewTransition(initial, {
      type: "rename",
      instanceId: workId,
      userLabel: "Renamed work relay",
      succeeds: true,
    });
    const labelCleared = applyFidelityPreviewTransition(initial, {
      type: "rename",
      instanceId: workId,
      userLabel: undefined,
      succeeds: true,
    });
    const renameFailed = applyFidelityPreviewTransition(initial, {
      type: "rename",
      instanceId: workId,
      userLabel: "Ignored after failure",
      succeeds: false,
    });

    expect(refreshed).not.toBe(initial);
    expect(parseAppViewState(refreshed)).toEqual(refreshed);
    expect(
      disconnected.instances.find((instance) => instance.id === workId),
    ).toBeUndefined();
    expect(renamed.instances.find((instance) => instance.id === workId)?.userLabel).toBe(
      "Renamed work relay",
    );
    expect(
      Object.hasOwn(
        labelCleared.instances.find((instance) => instance.id === workId)!,
        "userLabel",
      ),
    ).toBe(false);
    expect(renameFailed).not.toBe(initial);
    expect(renameFailed.instances.find((instance) => instance.id === workId)?.userLabel).toBe(
      "Demo relay B",
    );
  });

  it("rejects malformed current state before every fidelity callback transition", () => {
    const initial = createFidelityPreviewState(
      request("settings", "default"),
      createFidelityScenario(request("settings", "default")),
    );
    const malformed = {
      ...initial,
      instances: [{ ...initial.instances[0]!, userLabel: undefined }],
    } as AppViewState;
    const workId = "newapi:22222222-2222-4222-8222-222222222222";

    const transitions: FidelityPreviewTransition[] = [
      { type: "display-mode", mode: "left" },
      { type: "auto-refresh", autoRefresh: false },
      { type: "refresh-status", instanceId: workId },
      { type: "disconnect", instanceId: workId },
      {
        type: "rename",
        instanceId: workId,
        userLabel: undefined,
        succeeds: true,
      },
      {
        type: "rename",
        instanceId: workId,
        userLabel: "Ignored after failure",
        succeeds: false,
      },
    ];

    for (const transition of transitions) {
      expect(() => applyFidelityPreviewTransition(malformed, transition)).toThrow(
        "Missing application state",
      );
    }
  });
});
