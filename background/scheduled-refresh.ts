interface ScheduledRefreshDependencies<TState> {
  refreshAll(trigger: "scheduled"): Promise<unknown>;
  currentState(): Promise<TState>;
  syncRefreshAlarm(state: TState): Promise<void>;
}

export function launchScheduledRefresh<TState>(
  dependencies: ScheduledRefreshDependencies<TState>,
): void {
  let refresh: Promise<unknown>;
  try {
    refresh = dependencies.refreshAll("scheduled");
  } catch {
    refresh = Promise.resolve();
  }

  void refresh
    .catch(() => undefined)
    .then(() => dependencies.currentState())
    .then((state) => dependencies.syncRefreshAlarm(state))
    .catch(() => undefined);
}
