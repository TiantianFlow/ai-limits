import type { ProviderId } from "../../domain/model";
import type { ApiKeyProviderId } from "../../providers/catalog";

export type CockpitScreen =
  | { name: "overview" }
  | { name: "provider"; providerId: ProviderId }
  | { name: "history"; providerId: ProviderId; windowId?: string }
  | { name: "settings" }
  | { name: "add-provider" }
  | {
      name: "api-key-connect";
      providerId: ApiKeyProviderId;
      mode: "connect" | "replace";
    };

export interface CockpitNavigationState {
  current: CockpitScreen;
  backStack: CockpitScreen[];
}

export type CockpitAction =
  | { type: "push"; screen: CockpitScreen }
  | { type: "pop" }
  | { type: "home" };

function sameScreen(left: CockpitScreen, right: CockpitScreen): boolean {
  if (left.name !== right.name) {
    return false;
  }

  if (left.name === "provider" && right.name === "provider") {
    return left.providerId === right.providerId;
  }

  if (left.name === "history" && right.name === "history") {
    return (
      left.providerId === right.providerId && left.windowId === right.windowId
    );
  }

  if (left.name === "api-key-connect" && right.name === "api-key-connect") {
    return left.providerId === right.providerId && left.mode === right.mode;
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
  }
}
