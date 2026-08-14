import type { AppViewState } from "../../background/view-state";
import type { ProviderInstanceId } from "../../domain/instances";
import type { AppState } from "../../domain/model";
import type { ProviderOperation } from "../../background/events";
import { isProviderId, type ProviderKind } from "../../providers/catalog";

/**
 * Task 6-only bridge for the unchanged provider-kind Cockpit. It intentionally
 * refuses duplicate kinds so Task 5 cannot silently hide a second instance.
 */
export function projectLegacyInstanceState(view: AppViewState): {
  state: AppState;
  instanceIds: Partial<Record<ProviderKind, ProviderInstanceId>>;
} {
  const instanceIds: Partial<Record<ProviderKind, ProviderInstanceId>> = {};
  const providers = view.instances.map((instance) => {
    if (instanceIds[instance.providerKind]) {
      throw new Error("Legacy Cockpit cannot project duplicate provider kinds.");
    }
    instanceIds[instance.providerKind] = instance.id;
    return {
      providerId: instance.providerKind,
      access: instance.access,
      history: instance.history,
      ...(instance.snapshot === undefined ? {} : { snapshot: instance.snapshot }),
      ...(instance.lastAttempt === undefined
        ? {}
        : { lastAttempt: instance.lastAttempt }),
    };
  });
  return {
    state: {
      version: 4,
      preferences: view.preferences,
      providers,
    },
    instanceIds,
  };
}

export function projectLegacyInstanceOperations(
  operations: Partial<Record<ProviderInstanceId, ProviderOperation>>,
): Partial<Record<ProviderKind, ProviderOperation>> {
  const projected: Partial<Record<ProviderKind, ProviderOperation>> = {};
  for (const [instanceId, operation] of Object.entries(operations)) {
    if (!operation) continue;
    const providerKind = instanceId.slice(0, instanceId.indexOf(":"));
    if (!isProviderId(providerKind)) continue;
    if (projected[providerKind]) {
      throw new Error(
        "Legacy Cockpit cannot project duplicate provider operations.",
      );
    }
    projected[providerKind] = operation;
  }
  return projected;
}
