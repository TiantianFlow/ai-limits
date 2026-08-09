import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ProviderSnapshot } from "../domain/model";
import { createFixtureState } from "../providers/fixtures";
import type { CollectionResult, ProviderAdapter } from "../providers/types";
import { loadState, saveState, setDisplayMode } from "../storage/repository";
import { refreshProvider } from "./coordinator";

const NOW = 1_800_000_000_000;

function liveSnapshot(
  providerId: ProviderSnapshot["providerId"] = "chatgpt",
): ProviderSnapshot {
  return {
    providerId,
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
  return providerAdapter("chatgpt", collect);
}

function providerAdapter(
  id: ProviderAdapter["id"],
  collect: ProviderAdapter["collect"],
): ProviderAdapter {
  return {
    id,
    capabilities: { browserSession: true },
    optionalOrigins: [`https://${id}.example/*`],
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

function liveState(now: number) {
  const state = createFixtureState(now);
  for (const provider of state.providers) {
    if (provider.snapshot) {
      provider.snapshot.source = "web-session";
    }
  }
  return state;
}

beforeEach(async () => {
  await browser.storage.local.clear();
});

describe("provider refresh coordinator", () => {
  test("atomically replaces only ChatGPT and clears its error", async () => {
    const initial = liveState(NOW - 60_000);
    initial.providers[0]!.health = {
      kind: "temporary_error",
      retryAt: NOW + 300_000,
    };
    await saveState(initial);
    const claudeBefore = initial.providers[1];
    const successful = adapter(async (): Promise<CollectionResult> => ({
      ok: true,
      snapshot: liveSnapshot("claude"),
    }));

    const outcome = await refreshProvider(successful, collectionContext());

    expect(outcome).toEqual({
      kind: "success",
      snapshot: liveSnapshot(),
    });

    const state = await loadState();
    expect(state?.providers[0]).toEqual({
      providerId: "chatgpt",
      health: { kind: "connected" },
      snapshot: liveSnapshot(),
    });
    expect(state?.providers[1]).toEqual(claudeBefore);
  });

  test("preserves the last-good snapshot while updating failed health", async () => {
    const initial = liveState(NOW - 60_000);
    await saveState(initial);
    const snapshotBefore = initial.providers[0]?.snapshot;

    const outcome = await refreshProvider(
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
    expect(outcome).toEqual({
      kind: "failure",
      category: "provider_changed",
      message: "Usage response changed.",
    });
  });

  test("contains thrown adapter errors as temporary ChatGPT failures without changing Claude", async () => {
    const initial = liveState(NOW - 60_000);
    await saveState(initial);
    const claudeBefore = initial.providers[1];

    const outcome = await refreshProvider(
      adapter(async () => {
        throw new Error("secret-bearing provider failure");
      }),
      collectionContext(),
    );

    const state = await loadState();
    expect(state?.providers[0]?.snapshot).toEqual(initial.providers[0]?.snapshot);
    expect(state?.providers[0]?.health).toEqual({ kind: "temporary_error" });
    expect(state?.providers[1]).toEqual(claudeBefore);
    expect(outcome).toEqual({
      kind: "failure",
      category: "temporary_error",
    });
  });

  test("applies the collection to fresh repository state without clobbering an in-flight preference update", async () => {
    await saveState(liveState(NOW - 60_000));
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

  test("retains both provider results when successful collections commit concurrently", async () => {
    await saveState(liveState(NOW - 60_000));
    const chatGptSnapshot = liveSnapshot("chatgpt");
    const claudeSnapshot = liveSnapshot("claude");

    await Promise.all([
      refreshProvider(
        providerAdapter("chatgpt", async () => ({
          ok: true,
          snapshot: chatGptSnapshot,
        })),
        collectionContext(),
      ),
      refreshProvider(
        providerAdapter("claude", async () => ({
          ok: true,
          snapshot: claudeSnapshot,
        })),
        collectionContext(),
      ),
    ]);

    const providers = (await loadState())?.providers;
    expect(providers?.find(({ providerId }) => providerId === "chatgpt")).toEqual({
      providerId: "chatgpt",
      health: { kind: "connected" },
      snapshot: chatGptSnapshot,
    });
    expect(providers?.find(({ providerId }) => providerId === "claude")).toEqual({
      providerId: "claude",
      health: { kind: "connected" },
      snapshot: claudeSnapshot,
    });
  });
});
