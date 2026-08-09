import { describe, expect, test } from "vitest";

import { createFixtureState } from "../providers/fixtures";
import { updateAutoRefreshTransaction } from "./auto-refresh";

const NOW = Date.UTC(2026, 7, 9, 4);

describe("automatic refresh transaction", () => {
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
