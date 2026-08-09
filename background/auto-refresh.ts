import type { AppState } from "../domain/model";

export interface AutoRefreshTransactionDependencies {
  readState(): Promise<AppState>;
  writePreference(enabled: boolean): Promise<void>;
  syncAlarm(state: AppState): Promise<void>;
}

export async function updateAutoRefreshTransaction(
  enabled: boolean,
  dependencies: AutoRefreshTransactionDependencies,
): Promise<AppState> {
  const previous = await dependencies.readState();
  await dependencies.writePreference(enabled);

  try {
    const updated = await dependencies.readState();
    await dependencies.syncAlarm(updated);
    return updated;
  } catch (error) {
    try {
      await dependencies.writePreference(previous.preferences.autoRefresh);
      const restored = await dependencies.readState();
      await dependencies.syncAlarm(restored);
    } catch {
      // Preserve the original transaction failure after best-effort rollback.
    }
    throw error;
  }
}
