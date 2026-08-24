import type {
  ApiKeyProviderKind,
  ProviderInstanceId,
} from "../../domain/public-protocol";

export type CockpitScreen =
  | { name: "overview" }
  | { name: "provider"; instanceId: ProviderInstanceId }
  | { name: "history"; instanceId: ProviderInstanceId; metricId?: string }
  | { name: "settings" }
  | { name: "add-provider" }
  | {
      name: "api-key-connect";
      providerKind: ApiKeyProviderKind;
      mode: "connect" | "replace";
      instanceId?: ProviderInstanceId;
    };

export interface CockpitNavigationState {
  current: CockpitScreen;
  backStack: CockpitScreen[];
}

export type CockpitAction =
  | { type: "push"; screen: CockpitScreen }
  | { type: "pop" }
  | { type: "home" }
  | { type: "dropInstance"; instanceId: ProviderInstanceId };

export function screenUsesInstance(
  screen: CockpitScreen,
  instanceId: ProviderInstanceId,
): boolean {
  return (
    (screen.name === "provider" && screen.instanceId === instanceId) ||
    (screen.name === "history" && screen.instanceId === instanceId) ||
    (screen.name === "api-key-connect" && screen.instanceId === instanceId)
  );
}

function sameScreen(left: CockpitScreen, right: CockpitScreen): boolean {
  if (left.name !== right.name) {
    return false;
  }

  if (left.name === "provider" && right.name === "provider") {
    return left.instanceId === right.instanceId;
  }

  if (left.name === "history" && right.name === "history") {
    return (
      left.instanceId === right.instanceId && left.metricId === right.metricId
    );
  }

  if (left.name === "api-key-connect" && right.name === "api-key-connect") {
    return (
      left.providerKind === right.providerKind &&
      left.mode === right.mode &&
      left.instanceId === right.instanceId
    );
  }

  return true;
}

export function navigateCockpit(
  state: CockpitNavigationState,
  action: CockpitAction,
): CockpitNavigationState {
  switch (action.type) {
    case "push":
      return sameScreen(state.current, action.screen)
        ? state
        : {
            current: action.screen,
            backStack: [...state.backStack, state.current],
          };
    case "pop": {
      const previous = state.backStack.at(-1);
      return previous
        ? {
            current: previous,
            backStack: state.backStack.slice(0, -1),
          }
        : state;
    }
    case "home":
      return state.current.name === "overview" && state.backStack.length === 0
        ? state
        : { current: { name: "overview" }, backStack: [] };
    case "dropInstance": {
      const remainingStack = state.backStack.filter(
        (screen) => !screenUsesInstance(screen, action.instanceId),
      );
      const currentUsesInstance = screenUsesInstance(
        state.current,
        action.instanceId,
      );
      if (
        !currentUsesInstance &&
        remainingStack.length === state.backStack.length
      ) {
        return state;
      }
      if (!currentUsesInstance) {
        return { current: state.current, backStack: remainingStack };
      }
      const previous = remainingStack.at(-1);
      return previous
        ? {
            current: previous,
            backStack: remainingStack.slice(0, -1),
          }
        : { current: { name: "overview" }, backStack: [] };
    }
  }
}
