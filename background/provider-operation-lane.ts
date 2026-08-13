import type { ProviderId } from "../providers/catalog";

type ProviderOperationKind = "refresh" | "connect";

export interface ProviderOperationToken {
  readonly providerId: ProviderId;
  readonly generation: number;
  readonly kind: ProviderOperationKind;
}

export interface ProviderCleanupToken {
  readonly providerId: ProviderId;
}

interface ProviderLaneState {
  generation: number;
  cleanupDepth: number;
  active?: ProviderOperationToken;
}

export interface ProviderOperationLane {
  beginRefresh(providerId: ProviderId): ProviderOperationToken | undefined;
  beginConnect(providerId: ProviderId): ProviderOperationToken | undefined;
  beginCleanup(providerId: ProviderId): ProviderCleanupToken;
  endCleanup(token: ProviderCleanupToken): void;
  finish(token: ProviderOperationToken): void;
  isCurrent(token: ProviderOperationToken): boolean;
  canRefresh(providerId: ProviderId): boolean;
  isCleaning(providerId: ProviderId): boolean;
}

export function createProviderOperationLane(): ProviderOperationLane {
  const states = new Map<ProviderId, ProviderLaneState>();
  const stateFor = (providerId: ProviderId): ProviderLaneState => {
    const existing = states.get(providerId);
    if (existing) return existing;
    const state = { generation: 0, cleanupDepth: 0 };
    states.set(providerId, state);
    return state;
  };

  const begin = (
    providerId: ProviderId,
    kind: ProviderOperationKind,
  ): ProviderOperationToken | undefined => {
    const state = stateFor(providerId);
    if (
      state.cleanupDepth > 0 ||
      (kind === "refresh" && state.active?.kind === "connect")
    ) {
      return undefined;
    }

    const token = {
      providerId,
      generation: state.generation + 1,
      kind,
    } satisfies ProviderOperationToken;
    state.generation = token.generation;
    state.active = token;
    return token;
  };

  return {
    beginRefresh(providerId) {
      return begin(providerId, "refresh");
    },
    beginConnect(providerId) {
      return begin(providerId, "connect");
    },
    beginCleanup(providerId) {
      const state = stateFor(providerId);
      state.cleanupDepth += 1;
      state.generation += 1;
      state.active = undefined;
      return { providerId };
    },
    endCleanup(token) {
      const state = stateFor(token.providerId);
      state.cleanupDepth = Math.max(0, state.cleanupDepth - 1);
      if (state.cleanupDepth === 0) {
        state.generation += 1;
      }
    },
    finish(token) {
      const state = stateFor(token.providerId);
      if (
        state.active?.generation === token.generation &&
        state.active.kind === token.kind
      ) {
        state.active = undefined;
      }
    },
    isCurrent(token) {
      const state = stateFor(token.providerId);
      return (
        state.cleanupDepth === 0 &&
        state.active?.generation === token.generation &&
        state.active.kind === token.kind
      );
    },
    canRefresh(providerId) {
      const state = stateFor(providerId);
      return state.cleanupDepth === 0 && state.active?.kind !== "connect";
    },
    isCleaning(providerId) {
      return stateFor(providerId).cleanupDepth > 0;
    },
  };
}
