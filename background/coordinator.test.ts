import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ProviderSnapshot } from "../domain/model";
import { createFixtureState } from "../providers/fixtures";
import type { CollectionResult, ProviderAdapter } from "../providers/types";
import { loadState, saveState, setDisplayMode } from "../storage/repository";
import { refreshProvider } from "./coordinator";

const NOW = 1_800_000_000_000;

function liveSnapshot(): ProviderSnapshot {
  return {
    providerId: "chatgpt",
    planLabel: "Plus",
    source: "web-session",
    fetchedAt: NOW,
    windows: [
      {
        id: "five-hour",
        label: "5-hour messages",
        kind: "rolling",
        usedRatio: 0.4,
        resetsAt: NOW + 60_000,
        durationMs: 18_000_000,
        sourceSemantics: "used",
      },
    ],
    credits: [],
  };
}

function adapter(
  collect: ProviderAdapter["collect"],
): ProviderAdapter {
  return {
    id: "chatgpt",
    capabilities: { browserSession: true },
    optionalOrigins: ["https://chatgpt.com/*"],
    collect,
  };
}

function collectionContext() {
  return {
    fetch: vi.fn<typeof globalThis.fetch>(),
    now: NOW,
    signal: new AbortController().signal,
  };
}

beforeEach(async () => {
  await browser.storage.local.clear();
});

describe("provider refresh coordinator", () => {
  test("atomically replaces only ChatGPT and clears its error while another fixture keeps demo mode active", async () => {
    const initial = createFixtureState(NOW - 60_000);
    initial.providers[0]!.health = {
      kind: "temporary_error",
      retryAt: NOW + 300_000,
    };
    await saveState(initial);
    const claudeBefore = initial.providers[1];
    const successful = adapter(async (): Promise<CollectionResult> => ({
      ok: true,
      snapshot: liveSnapshot(),
    }));

    await refreshProvider(successful, collectionContext());

    const state = await loadState();
    expect(state?.providers[0]).toEqual({
      providerId: "chatgpt",
      health: { kind: "connected" },
      snapshot: liveSnapshot(),
    });
    expect(state?.providers[1]).toEqual(claudeBefore);
    expect(state?.demoMode).toBe(true);
  });

  test("turns off demo mode when the successful refresh replaces the final fixture", async () => {
    const initial = createFixtureState(NOW - 60_000);
    for (const provider of initial.providers.slice(1)) {
      if (provider.snapshot) {
        provider.snapshot.source = "web-session";
      }
    }
    await saveState(initial);

    await refreshProvider(
      adapter(async () => ({ ok: true, snapshot: liveSnapshot() })),
      collectionContext(),
    );

    expect((await loadState())?.demoMode).toBe(false);
  });

  test("preserves the last-good snapshot while updating failed health", async () => {
    const initial = createFixtureState(NOW - 60_000);
    await saveState(initial);
    const snapshotBefore = initial.providers[0]?.snapshot;

    await refreshProvider(
      adapter(async () => ({
        ok: false,
        health: { kind: "provider_changed", message: "Usage response changed." },
      })),
      collectionContext(),
    );

    const chatGpt = (await loadState())?.providers[0];
    expect(chatGpt?.snapshot).toEqual(snapshotBefore);
    expect(chatGpt?.health).toEqual({
      kind: "provider_changed",
      message: "Usage response changed.",
    });
  });

  test("contains thrown adapter errors as temporary ChatGPT failures without changing Claude", async () => {
    const initial = createFixtureState(NOW - 60_000);
    await saveState(initial);
    const claudeBefore = initial.providers[1];

    await refreshProvider(
      adapter(async () => {
        throw new Error("secret-bearing provider failure");
      }),
      collectionContext(),
    );

    const state = await loadState();
    expect(state?.providers[0]?.snapshot).toEqual(initial.providers[0]?.snapshot);
    expect(state?.providers[0]?.health).toEqual({ kind: "temporary_error" });
    expect(state?.providers[1]).toEqual(claudeBefore);
  });

  test("applies the collection to fresh repository state without clobbering an in-flight preference update", async () => {
    await saveState(createFixtureState(NOW - 60_000));
    let finishCollection!: (result: CollectionResult) => void;
    const collect = vi.fn(
      () =>
        new Promise<CollectionResult>((resolve) => {
          finishCollection = resolve;
        }),
    );

    const refreshing = refreshProvider(adapter(collect), collectionContext());
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    await setDisplayMode("left");
    finishCollection({ ok: true, snapshot: liveSnapshot() });
    await refreshing;

    expect((await loadState())?.preferences.displayMode).toBe("left");
  });
});
