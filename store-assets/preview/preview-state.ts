import { parseAppViewState, type AppViewState } from "../../domain/public-protocol";
import type { AppState } from "../../domain/model";
import { createFixtureState } from "../../providers/fixtures";
import { createInitialState } from "../../providers/initial-state";
import type { FidelityRequest, FidelityScenario } from "./copy";
import { prepareFidelityViewState } from "./fidelity-state";

function parsePreviewState(candidate: unknown): AppViewState {
  return parseAppViewState(candidate);
}

function fixtureViewState(state: AppState, now: number): AppViewState {
  const connectedInstances = state.providers.filter(
    (provider) =>
      provider.access === "granted" ||
      provider.snapshot !== undefined ||
      provider.history.length > 0 ||
      provider.lastAttempt !== undefined,
  );
  return parsePreviewState({
    preferences: state.preferences,
    instances: connectedInstances.flatMap((provider) => {
      const instance = {
        id: `${provider.providerId}:default`,
        providerKind: provider.providerId,
        access: provider.access,
        createdAt: now - 2_000,
        history: provider.history,
        ...(provider.providerId === "newapi"
          ? {
              userLabel: "Personal relay",
              baseUrl: "https://relay.example/gateway",
              origin: "https://relay.example",
            }
          : {}),
        ...(provider.snapshot ? { snapshot: provider.snapshot } : {}),
        ...(provider.lastAttempt ? { lastAttempt: provider.lastAttempt } : {}),
      } satisfies AppViewState["instances"][number];
      if (provider.providerId !== "newapi") return [instance];

      const second = {
        ...structuredClone(instance),
        id: "newapi:22222222-2222-4222-8222-222222222222",
        userLabel: "Work relay for product engineering",
        createdAt: now - 1_000,
      } satisfies AppViewState["instances"][number];
      const snapshot = instance.snapshot
        ? {
            ...instance.snapshot,
            metrics: instance.snapshot.metrics.map((metric) =>
              metric.type === "quota"
                ? { ...metric, usedRatio: Math.min(1, metric.usedRatio + 0.18) }
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
  const fixture = createFixtureState(now);

  if (parameters.get("providers") === "none") {
    return fixtureViewState(createInitialState(), now);
  }

  if (parameters.get("providers") === "partial") {
    const initial = createInitialState();
    initial.providers[0] = fixture.providers[0]!;
    return fixtureViewState(initial, now);
  }

  return fixtureViewState(fixture, now);
}

export function createFidelityPreviewState(
  request: FidelityRequest,
  scenario: FidelityScenario,
): AppViewState {
  const fixture = createFixtureState(request.now);
  let state: AppState;

  if (scenario.fixtureVariant === "empty") {
    state = createInitialState();
  } else if (scenario.fixtureVariant === "partial") {
    state = createInitialState();
    state.providers[0] = fixture.providers[0]!;
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
    const kimi = state.providers.find(
      (provider) => provider.providerId === "kimi",
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
  return parsePreviewState(update(current));
}
