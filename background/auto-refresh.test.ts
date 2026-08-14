import { describe, expect, test, vi } from "vitest";

import { createFixtureState } from "../providers/fixtures";
import {
  createSerializedStateReconciler,
  updateAutoRefreshTransaction,
} from "./auto-refresh";

const NOW = Date.UTC(2026, 7, 9, 4);

describe("automatic refresh transaction", () => {
  test("serializes reconciliation and reloads authoritative state for every queued transition", async () => {
    let state = { connected: true };
    let releaseFirst!: () => void;
    const firstReconciliation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const applied: boolean[] = [];
    const readState = vi.fn(async () => ({ ...state }));
    const reconcile = createSerializedStateReconciler(
      readState,
      async (candidate) => {
        applied.push(candidate.connected);
        if (applied.length === 1) await firstReconciliation;
      },
    );

    const connect = reconcile();
    await vi.waitFor(() => expect(applied).toEqual([true]));
    state = { connected: false };
    const disconnect = reconcile();

    expect(readState).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([connect, disconnect]);

    expect(readState).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([true, false]);
  });

  test("restores the persisted preference and prior alarm state when alarm sync fails", async () => {
    let state = createFixtureState(NOW);
    const syncedPreferences: boolean[] = [];

    await expect(
      updateAutoRefreshTransaction(false, {
        readState: async () => structuredClone(state),
        writePreference: async (enabled) => {
          state = {
            ...state,
            preferences: { ...state.preferences, autoRefresh: enabled },
          };
        },
        syncAlarm: async (candidate) => {
          syncedPreferences.push(candidate.preferences.autoRefresh);
          if (!candidate.preferences.autoRefresh) {
            throw new Error("alarm unavailable");
          }
        },
      }),
    ).rejects.toThrow("alarm unavailable");

    expect(state.preferences.autoRefresh).toBe(true);
    expect(syncedPreferences).toEqual([false, true]);
  });
});
