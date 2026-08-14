import { parseAppViewState, type AppViewState } from "../../domain/public-protocol";
import type {
  DisplayMode,
  ProviderInstanceId,
} from "../../domain/public-protocol";
import {
  createEmptyFixtureState,
  createFixtureState,
} from "../../providers/fixtures";
import type { FidelityRequest, FidelityScenario } from "./copy";
import { prepareFidelityViewState } from "./fidelity-state";

function parsePreviewState(candidate: unknown): AppViewState {
  return parseAppViewState(candidate);
}

function fixtureViewState(state: AppViewState, now: number): AppViewState {
  return parsePreviewState({
    preferences: state.preferences,
    providers: state.providers,
    instances: state.instances.flatMap((provider) => {
      const instance = {
        ...provider,
        createdAt: now - 2_000,
      } satisfies AppViewState["instances"][number];
      if (provider.providerKind !== "newapi") return [instance];

      const second = {
        ...structuredClone(instance),
        id: "newapi:22222222-2222-4222-8222-222222222222",
        userLabel: "Demo relay B",
        createdAt: now - 1_000,
      } satisfies AppViewState["instances"][number];
      const snapshot = instance.snapshot
        ? {
            ...instance.snapshot,
            metrics: instance.snapshot.metrics.map((metric) =>
              metric.type === "quota"
                ? (() => {
                    const usedRatio = Math.min(1, metric.usedRatio + 0.18);
                    return {
                      ...metric,
                      usedRatio,
                      ...(metric.used !== undefined && metric.limit !== undefined
                        ? { used: metric.limit * usedRatio }
                        : {}),
                    };
                  })()
                : metric,
            ),
          }
        : undefined;
      return [instance, ...(snapshot ? [{ ...second, snapshot }] : [second])];
    }),
  });
}

export function createStorePreviewState(
  parameters: URLSearchParams,
  now: number,
): AppViewState {
  const fixture = createFixtureState(now, { includeAccountLabels: true });

  if (parameters.get("providers") === "none") {
    return fixtureViewState(createEmptyFixtureState(), now);
  }

  if (parameters.get("providers") === "partial") {
    const initial = createEmptyFixtureState();
    initial.instances = fixture.instances.slice(0, 1);
    return fixtureViewState(initial, now);
  }

  return fixtureViewState(fixture, now);
}

export function createFidelityPreviewState(
  request: FidelityRequest,
  scenario: FidelityScenario,
): AppViewState {
  const fixture = createFixtureState(request.now, {
    includeAccountLabels: true,
  });
  let state: AppViewState;

  if (scenario.fixtureVariant === "empty") {
    state = createEmptyFixtureState();
  } else if (scenario.fixtureVariant === "partial") {
    state = createEmptyFixtureState();
    state.instances = fixture.instances.slice(0, 1);
  } else {
    state = fixture;
  }

  state.preferences = {
    ...state.preferences,
    displayMode: request.mode,
  };

  if (
    request.state === "partial-refresh" ||
    request.state === "kimi-interaction"
  ) {
    const kimi = state.instances.find(
      (provider) => provider.providerKind === "kimi",
    );
    if (kimi) {
      kimi.lastAttempt = {
        trigger: "scheduled",
        startedAt: request.now - 15_000,
        finishedAt: request.now - 10_000,
        outcome: { kind: "deferred", reason: "session_required" },
      };
    }
  }

  return parsePreviewState(
    prepareFidelityViewState(fixtureViewState(state, request.now), request.state),
  );
}

export function updatePreviewState(
  current: AppViewState,
  update: (state: AppViewState) => unknown,
): AppViewState {
  return parsePreviewState(update(parsePreviewState(current)));
}

export type FidelityPreviewTransition =
  | { type: "display-mode"; mode: DisplayMode }
  | { type: "auto-refresh"; autoRefresh: boolean }
  | { type: "refresh-status"; instanceId?: ProviderInstanceId }
  | { type: "disconnect"; instanceId: ProviderInstanceId }
  | {
      type: "rename";
      instanceId: ProviderInstanceId;
      userLabel?: string;
      succeeds: boolean;
    };

export function applyFidelityPreviewTransition(
  current: AppViewState,
  transition: FidelityPreviewTransition,
): AppViewState {
  return updatePreviewState(current, (state) => {
    if (transition.type === "display-mode") {
      return {
        ...state,
        preferences: { ...state.preferences, displayMode: transition.mode },
      };
    }
    if (transition.type === "auto-refresh") {
      return {
        ...state,
        preferences: { ...state.preferences, autoRefresh: transition.autoRefresh },
      };
    }
    if (transition.type === "refresh-status") {
      return state;
    }
    if (transition.type === "disconnect") {
      return {
        ...state,
        instances: state.instances.filter(
          (instance) => instance.id !== transition.instanceId,
        ),
      };
    }
    return {
      ...state,
      instances: state.instances.map((instance) => {
        if (instance.id !== transition.instanceId || !transition.succeeds) {
          return instance;
        }
        if (transition.userLabel === undefined) {
          const { userLabel: _userLabel, ...unlabeled } = instance;
          return unlabeled;
        }
        return { ...instance, userLabel: transition.userLabel };
      }),
    };
  });
}
