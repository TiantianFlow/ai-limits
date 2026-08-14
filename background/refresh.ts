import type { ProviderInstanceId } from "../domain/instances";
import type {
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
} from "../domain/model";

export async function refreshGrantedInstances(
  instanceIds: readonly ProviderInstanceId[],
  hasPermission: (instanceId: ProviderInstanceId) => Promise<boolean>,
  collect: (instanceId: ProviderInstanceId) => Promise<ProviderRefreshOutcome>,
  trigger: RefreshTrigger,
  clock: () => number = Date.now,
): Promise<RefreshReport> {
  const startedAt = clock();
  const results = await Promise.all(
    instanceIds.map(async (instanceId) => {
      try {
        if (!(await hasPermission(instanceId))) {
          return {
            instanceId,
            outcome: { kind: "skipped", reason: "permission_required" } as const,
          };
        }
        return { instanceId, outcome: await collect(instanceId) };
      } catch {
        return {
          instanceId,
          outcome: { kind: "failure", category: "temporary_error" } as const,
        };
      }
    }),
  );
  return { trigger, startedAt, finishedAt: clock(), results };
}
