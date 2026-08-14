interface AutoRefreshState {
  preferences: { autoRefresh: boolean };
}

export function createSerializedStateReconciler<TState>(
  readState: () => Promise<TState>,
  reconcileState: (state: TState) => Promise<void>,
): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  return () => {
    const reconciliation = queue.then(async () => {
      const authoritative = await readState();
      await reconcileState(authoritative);
    });
    queue = reconciliation.catch(() => undefined);
    return reconciliation;
  };
}

export interface AutoRefreshTransactionDependencies<TState extends AutoRefreshState> {
  readState(): Promise<TState>;
  writePreference(enabled: boolean): Promise<void>;
  syncAlarm(state: TState): Promise<void>;
}

export async function updateAutoRefreshTransaction<TState extends AutoRefreshState>(
  enabled: boolean,
  dependencies: AutoRefreshTransactionDependencies<TState>,
): Promise<TState> {
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
