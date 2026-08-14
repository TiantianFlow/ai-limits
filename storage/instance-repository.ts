import type {
  InstanceAppState,
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/instances";
import type { DisplayMode } from "../domain/model";
import {
  createEmptyInstanceAppState,
  normalizeInstanceAppState,
} from "./state-codec";

export const INSTANCE_STATE_STORAGE_KEY = "aiLimitsState";

let stateMutationQueue: Promise<void> = Promise.resolve();

function enqueueStateMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = stateMutationQueue.then(mutation);
  stateMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readNormalizedState(now: number): Promise<InstanceAppState> {
  const stored = await browser.storage.local.get(INSTANCE_STATE_STORAGE_KEY);
  return normalizeInstanceAppState(stored[INSTANCE_STATE_STORAGE_KEY], now);
}

async function writeNormalizedState(
  state: InstanceAppState,
  now: number,
): Promise<InstanceAppState> {
  const normalized = normalizeInstanceAppState(state, now);
  await browser.storage.local.set({
    [INSTANCE_STATE_STORAGE_KEY]: normalized,
  });
  return normalized;
}

function mutateState<T>(
  updater: (state: InstanceAppState, now: number) => T | Promise<T>,
): Promise<T> {
  return enqueueStateMutation(async () => {
    const now = Date.now();
    const state = await readNormalizedState(now);
    return updater(state, now);
  });
}

export async function loadInstanceAppState(): Promise<InstanceAppState> {
  return readNormalizedState(Date.now());
}

export const connectionRepository = {
  async list(): Promise<ProviderInstanceRecord[]> {
    return (await loadInstanceAppState()).instances;
  },

  async get(
    id: ProviderInstanceId,
  ): Promise<ProviderInstanceRecord | undefined> {
    return (await loadInstanceAppState()).instances.find(
      (instance) => instance.id === id,
    );
  },

  create(instance: ProviderInstanceRecord): Promise<void> {
    return mutateState(async (state, now) => {
      const normalizedCandidate = normalizeInstanceAppState(
        {
          version: 5,
          preferences: state.preferences,
          instances: [instance],
        },
        now,
      ).instances[0];
      const duplicateId = state.instances.some(
        (candidate) => candidate.id === instance.id,
      );
      const singletonConflict = state.instances.some(
        (candidate) =>
          candidate.providerKind === instance.providerKind &&
          instance.providerKind !== "newapi",
      );
      if (!normalizedCandidate || duplicateId || singletonConflict) {
        throw new Error("Provider instance cannot be created.");
      }
      await writeNormalizedState(
        { ...state, instances: [...state.instances, normalizedCandidate] },
        now,
      );
    });
  },

  rename(id: ProviderInstanceId, userLabel?: string): Promise<void> {
    return mutateState(async (state, now) => {
      const normalizedLabel = userLabel?.trim();
      await writeNormalizedState(
        {
          ...state,
          instances: state.instances.map((instance) =>
            instance.id !== id
              ? instance
              : {
                  ...instance,
                  ...(normalizedLabel
                    ? { userLabel: normalizedLabel }
                    : { userLabel: undefined }),
                },
          ),
        },
        now,
      );
    });
  },

  setAccess(
    id: ProviderInstanceId,
    access: "required" | "granted",
  ): Promise<void> {
    return mutateState(async (state, now) => {
      await writeNormalizedState(
        {
          ...state,
          instances: state.instances.map((instance) =>
            instance.id === id ? { ...instance, access } : instance,
          ),
        },
        now,
      );
    });
  },

  delete(id: ProviderInstanceId): Promise<void> {
    return mutateState(async (state, now) => {
      await writeNormalizedState(
        {
          ...state,
          instances: state.instances.filter((instance) => instance.id !== id),
        },
        now,
      );
    });
  },
};

export const usageRepository = {
  commit(
    id: ProviderInstanceId,
    updater: (instance: ProviderInstanceRecord) => ProviderInstanceRecord,
  ): Promise<boolean> {
    return mutateState(async (state, now) => {
      const index = state.instances.findIndex((instance) => instance.id === id);
      if (index < 0) return false;
      const current = state.instances[index]!;
      const requested = updater(current);
      const candidate: ProviderInstanceRecord = {
        ...requested,
        id: current.id,
        providerKind: current.providerKind,
        ...(current.userLabel === undefined
          ? { userLabel: undefined }
          : { userLabel: current.userLabel }),
        config: current.config,
        access: current.access,
        createdAt: current.createdAt,
      };
      const instances = [...state.instances];
      instances[index] = candidate;
      const normalized = await writeNormalizedState(
        { ...state, instances },
        now,
      );
      return normalized.instances.some((instance) => instance.id === id);
    });
  },

  clear(id: ProviderInstanceId): Promise<void> {
    return mutateState(async (state, now) => {
      await writeNormalizedState(
        {
          ...state,
          instances: state.instances.map((instance) => {
            if (instance.id !== id) return instance;
            const {
              snapshot: _snapshot,
              lastAttempt: _lastAttempt,
              ...connection
            } = instance;
            return { ...connection, history: [] };
          }),
        },
        now,
      );
    });
  },
};

export const preferencesRepository = {
  setDisplayMode(mode: DisplayMode): Promise<void> {
    return mutateState(async (state, now) => {
      await writeNormalizedState(
        {
          ...state,
          preferences: { ...state.preferences, displayMode: mode },
        },
        now,
      );
    });
  },

  setAutoRefresh(enabled: boolean): Promise<void> {
    return mutateState(async (state, now) => {
      await writeNormalizedState(
        {
          ...state,
          preferences: { ...state.preferences, autoRefresh: enabled },
        },
        now,
      );
    });
  },
};

export function deleteAllInstanceData(): Promise<InstanceAppState> {
  return mutateState(async (_state, now) => {
    const empty = createEmptyInstanceAppState();
    await browser.storage.local.remove(INSTANCE_STATE_STORAGE_KEY);
    return writeNormalizedState(empty, now);
  });
}
