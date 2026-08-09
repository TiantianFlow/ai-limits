import { describe, expect, test, vi } from "vitest";

import { launchScheduledRefresh } from "./scheduled-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("scheduled refresh lifecycle", () => {
  test("reserves scheduled work synchronously, then reconciles state and the alarm", async () => {
    const refresh = deferred<void>();
    const state = { durable: true };
    const events: string[] = [];
    const refreshAll = vi.fn(() => {
      events.push("refresh");
      return refresh.promise;
    });
    const currentState = vi.fn(async () => {
      events.push("state");
      return state;
    });
    const syncRefreshAlarm = vi.fn(async () => {
      events.push("alarm");
    });

    launchScheduledRefresh({ refreshAll, currentState, syncRefreshAlarm });

    expect(events).toEqual(["refresh"]);
    expect(currentState).not.toHaveBeenCalled();

    refresh.resolve();
    await vi.waitFor(() => expect(syncRefreshAlarm).toHaveBeenCalledWith(state));
    expect(events).toEqual(["refresh", "state", "alarm"]);
  });

  test("contains refresh failure but still reconciles authoritative state", async () => {
    const state = { durable: true };
    const currentState = vi.fn(async () => state);
    const syncRefreshAlarm = vi.fn(async () => undefined);

    expect(() =>
      launchScheduledRefresh({
        refreshAll: () => Promise.reject(new Error("private failure")),
        currentState,
        syncRefreshAlarm,
      }),
    ).not.toThrow();

    await vi.waitFor(() => expect(syncRefreshAlarm).toHaveBeenCalledWith(state));
  });
});
