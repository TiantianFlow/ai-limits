import type {
  AppViewState,
  ProviderInstanceId,
} from "../../domain/public-protocol";

export function moveInstanceId(
  ids: readonly ProviderInstanceId[],
  instanceId: ProviderInstanceId,
  offset: number,
): ProviderInstanceId[] {
  const from = ids.indexOf(instanceId);
  if (from < 0) return [...ids];
  const to = Math.min(ids.length - 1, Math.max(0, from + offset));
  const next = ids.filter((id) => id !== instanceId);
  next.splice(to, 0, instanceId);
  return next;
}

// The Overview arranges only connected instances. Their new order fills the
// slots they already held in the full list, so instances that are not shown
// there (such as ones waiting to reconnect) keep their positions.
export function mergeSubsetOrder(
  allIds: readonly ProviderInstanceId[],
  subsetIds: readonly ProviderInstanceId[],
): ProviderInstanceId[] {
  const subset = new Set(subsetIds);
  const queue = subsetIds.filter((id) => allIds.includes(id));
  return allIds.map((id) => (subset.has(id) ? queue.shift() ?? id : id));
}

export function withInstanceOrder(
  state: AppViewState,
  ids: readonly ProviderInstanceId[],
): AppViewState {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return {
    ...state,
    instances: state.instances
      .map((instance, index) => ({ instance, index }))
      .sort(
        (left, right) =>
          (rank.get(left.instance.id) ?? ids.length + left.index) -
          (rank.get(right.instance.id) ?? ids.length + right.index),
      )
      .map(({ instance }) => instance),
  };
}

export function withInstanceHidden(
  state: AppViewState,
  instanceId: ProviderInstanceId,
  hidden: boolean,
): AppViewState {
  return {
    ...state,
    instances: state.instances.map((instance) => {
      if (instance.id !== instanceId) return instance;
      const { hidden: _hidden, ...visible } = instance;
      return hidden ? { ...visible, hidden: true } : visible;
    }),
  };
}
