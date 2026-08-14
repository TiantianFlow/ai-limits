import type { ProviderInstanceId } from "../domain/instances";

type ProviderOperationKind = "refresh" | "connect";

export interface ProviderOperationToken {
  readonly instanceId: ProviderInstanceId;
  readonly generation: number;
  readonly kind: ProviderOperationKind;
}

export interface ProviderCleanupToken {
  readonly instanceId: ProviderInstanceId;
}

interface ProviderLaneState {
  generation: number;
  cleanupDepth: number;
  active?: ProviderOperationToken;
}

export interface ProviderOperationLane {
  beginRefresh(instanceId: ProviderInstanceId): ProviderOperationToken | undefined;
  beginConnect(instanceId: ProviderInstanceId): ProviderOperationToken | undefined;
  beginCleanup(instanceId: ProviderInstanceId): ProviderCleanupToken;
  endCleanup(token: ProviderCleanupToken): void;
  finish(token: ProviderOperationToken): void;
  isCurrent(token: ProviderOperationToken): boolean;
  canRefresh(instanceId: ProviderInstanceId): boolean;
  isCleaning(instanceId: ProviderInstanceId): boolean;
}

export function createProviderOperationLane(): ProviderOperationLane {
  const states = new Map<ProviderInstanceId, ProviderLaneState>();
  const stateFor = (instanceId: ProviderInstanceId): ProviderLaneState => {
    const existing = states.get(instanceId);
    if (existing) return existing;
    const state = { generation: 0, cleanupDepth: 0 };
    states.set(instanceId, state);
    return state;
  };

  const begin = (
    instanceId: ProviderInstanceId,
    kind: ProviderOperationKind,
  ): ProviderOperationToken | undefined => {
    const state = stateFor(instanceId);
    if (
      state.cleanupDepth > 0 ||
      (kind === "refresh" && state.active?.kind === "connect")
    ) {
      return undefined;
    }

    const token = {
      instanceId,
      generation: state.generation + 1,
      kind,
    } satisfies ProviderOperationToken;
    state.generation = token.generation;
    state.active = token;
    return token;
  };

  return {
    beginRefresh(instanceId) {
      return begin(instanceId, "refresh");
    },
    beginConnect(instanceId) {
      return begin(instanceId, "connect");
    },
    beginCleanup(instanceId) {
      const state = stateFor(instanceId);
      state.cleanupDepth += 1;
      state.generation += 1;
      state.active = undefined;
      return { instanceId };
    },
    endCleanup(token) {
      const state = stateFor(token.instanceId);
      state.cleanupDepth = Math.max(0, state.cleanupDepth - 1);
      if (state.cleanupDepth === 0) {
        state.generation += 1;
      }
    },
    finish(token) {
      const state = stateFor(token.instanceId);
      if (
        state.active?.generation === token.generation &&
        state.active.kind === token.kind
      ) {
        state.active = undefined;
      }
    },
    isCurrent(token) {
      const state = stateFor(token.instanceId);
      return (
        state.cleanupDepth === 0 &&
        state.active?.generation === token.generation &&
        state.active.kind === token.kind
      );
    },
    canRefresh(instanceId) {
      const state = stateFor(instanceId);
      return state.cleanupDepth === 0 && state.active?.kind !== "connect";
    },
    isCleaning(instanceId) {
      return stateFor(instanceId).cleanupDepth > 0;
    },
  };
}
