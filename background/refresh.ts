import type {
  ProviderId,
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
} from "../domain/model";
import type { RefreshCollector } from "../providers/types";

export async function refreshGrantedProviders<T extends ProviderId>(
  providerIds: readonly T[],
  hasPermission: (providerId: T) => Promise<boolean>,
  collect: RefreshCollector<T>,
  trigger: RefreshTrigger = "manual_all",
  clock: () => number = Date.now,
): Promise<RefreshReport> {
  const startedAt = clock();
  const results = await Promise.all(
    providerIds.map(async (providerId) => {
      try {
        if (!(await hasPermission(providerId))) {
          return [
            providerId,
            { kind: "skipped", reason: "permission_required" } as const,
          ] as const;
        }

        const outcome = await collect(providerId);
        return [providerId, outcome] as const;
      } catch {
        return [
          providerId,
          { kind: "failure", category: "temporary_error" },
        ] as const;
      }
    }),
  );

  const providers: Partial<Record<ProviderId, ProviderRefreshOutcome>> = {};
  for (const [providerId, outcome] of results) {
    providers[providerId] = outcome;
  }

  return {
    trigger,
    startedAt,
    finishedAt: clock(),
    providers,
  };
}
