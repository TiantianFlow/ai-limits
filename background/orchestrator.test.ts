import { describe, expect, test, vi } from "vitest";

import type {
  ProviderRefreshOutcome,
  ProviderSnapshot,
} from "../domain/model";
import {
  createRefreshOrchestrator,
  deriveRefreshPolicy,
  type ProviderRunControl,
  type RefreshPolicy,
} from "./orchestrator";

const NOW = 1_800_000_000_000;

function snapshot(providerId: ProviderSnapshot["providerId"]): ProviderSnapshot {
  return {
    providerId,
    source: "web-session",
    fetchedAt: NOW,
    windows: [],
    credits: [],
  };
}

function success(
  providerId: ProviderSnapshot["providerId"],
): ProviderRefreshOutcome {
  return { kind: "success", snapshot: snapshot(providerId) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("refresh policy derivation", () => {
  test.each([
    [
      "connect",
      {
        trigger: "connect",
        interaction: "allowed",
        bypassBackoff: true,
        deadlineMs: 20_000,
      },
    ],
    [
      "manual_provider",
      {
        trigger: "manual_provider",
        interaction: "allowed",
        bypassBackoff: true,
        deadlineMs: 20_000,
      },
    ],
    [
      "manual_all",
      {
        trigger: "manual_all",
        interaction: "allowed",
        bypassBackoff: true,
        deadlineMs: 20_000,
      },
    ],
    [
      "scheduled",
      {
        trigger: "scheduled",
        interaction: "forbidden",
        bypassBackoff: false,
        deadlineMs: 20_000,
      },
    ],
  ] satisfies ReadonlyArray<[RefreshPolicy["trigger"], RefreshPolicy]>) (
    "derives the literal %s policy inside the orchestrator boundary",
    (trigger, expected) => {
      expect(deriveRefreshPolicy(trigger)).toEqual(expected);
    },
  );
});

describe("refresh orchestrator", () => {
  test("joins simultaneous manual requests for the same provider", async () => {
    const pending = deferred<ProviderRefreshOutcome>();
    const runProvider = vi.fn(() => pending.promise);
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      hasPermission: async () => true,
      runProvider,
      clock: () => NOW,
    });

    const first = orchestrator.refreshProvider("chatgpt", "manual_provider");
    const second = orchestrator.refreshProvider("chatgpt", "manual_provider");
    await vi.waitFor(() => expect(runProvider).toHaveBeenCalledTimes(1));

    pending.resolve(success("chatgpt"));

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        trigger: "manual_provider",
        startedAt: NOW,
        finishedAt: NOW,
        providers: { chatgpt: success("chatgpt") },
      },
      {
        trigger: "manual_provider",
        startedAt: NOW,
        finishedAt: NOW,
        providers: { chatgpt: success("chatgpt") },
      },
    ]);
  });

  test("joins a scheduled request to stronger manual work", async () => {
    const pending = deferred<ProviderRefreshOutcome>();
    const policies: RefreshPolicy[] = [];
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      hasPermission: async () => true,
      runProvider: async (_providerId, policy) => {
        policies.push(policy);
        return pending.promise;
      },
      clock: () => NOW,
    });

    const manual = orchestrator.refreshProvider("chatgpt", "manual_provider");
    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(policies).toHaveLength(1));

    pending.resolve(success("chatgpt"));
    await Promise.all([manual, scheduled]);

    expect(policies).toEqual([deriveRefreshPolicy("manual_provider")]);
  });

  test("lets passive success satisfy a manual request without a follow-up", async () => {
    const pending = deferred<ProviderRefreshOutcome>();
    const policies: RefreshPolicy[] = [];
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      hasPermission: async () => true,
      runProvider: async (_providerId, policy) => {
        policies.push(policy);
        return pending.promise;
      },
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(policies).toHaveLength(1));
    const manual = orchestrator.refreshProvider("chatgpt", "manual_provider");

    pending.resolve(success("chatgpt"));

    await expect(manual).resolves.toMatchObject({
      providers: { chatgpt: success("chatgpt") },
    });
    await scheduled;
    expect(policies).toEqual([deriveRefreshPolicy("scheduled")]);
  });

  test.each([
    {
      label: "session-required deferral",
      outcome: {
        kind: "deferred",
        reason: "session_required",
      } satisfies ProviderRefreshOutcome,
    },
    {
      label: "recoverable temporary failure",
      outcome: {
        kind: "failure",
        category: "temporary_error",
      } satisfies ProviderRefreshOutcome,
    },
  ])("runs one interactive follow-up after a $label", async ({ outcome }) => {
    const passive = deferred<ProviderRefreshOutcome>();
    const interactive = deferred<ProviderRefreshOutcome>();
    const policies: RefreshPolicy[] = [];
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["kimi"],
      hasPermission: async () => true,
      runProvider: async (_providerId, policy) => {
        policies.push(policy);
        return policy.interaction === "forbidden"
          ? passive.promise
          : interactive.promise;
      },
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(policies).toHaveLength(1));
    const firstManual = orchestrator.refreshProvider("kimi", "manual_provider");
    const secondManual = orchestrator.refreshProvider("kimi", "manual_provider");

    passive.resolve(outcome);
    await vi.waitFor(() => expect(policies).toHaveLength(2));
    interactive.resolve(success("kimi"));

    await expect(Promise.all([firstManual, secondManual])).resolves.toEqual([
      expect.objectContaining({ providers: { kimi: success("kimi") } }),
      expect.objectContaining({ providers: { kimi: success("kimi") } }),
    ]);
    await expect(scheduled).resolves.toMatchObject({
      providers: { kimi: outcome },
    });
    expect(policies).toEqual([
      deriveRefreshPolicy("scheduled"),
      deriveRefreshPolicy("manual_provider"),
    ]);
  });

  test("invalidates an older generation before a newer provider run can commit", async () => {
    const passive = deferred<ProviderRefreshOutcome>();
    const interactive = deferred<ProviderRefreshOutcome>();
    const controls: ProviderRunControl[] = [];
    const committed: number[] = [];
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["kimi"],
      hasPermission: async () => true,
      runProvider: async (_providerId, policy, control) => {
        controls.push(control);
        return policy.interaction === "forbidden"
          ? passive.promise
          : interactive.promise;
      },
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(controls).toHaveLength(1));
    const manual = orchestrator.refreshProvider("kimi", "manual_provider");
    passive.resolve({ kind: "deferred", reason: "session_required" });
    await vi.waitFor(() => expect(controls).toHaveLength(2));

    if (controls[0]!.isCurrentGeneration()) committed.push(controls[0]!.generation);
    if (controls[1]!.isCurrentGeneration()) committed.push(controls[1]!.generation);
    interactive.resolve(success("kimi"));
    await Promise.all([scheduled, manual]);

    expect(controls.map(({ generation }) => generation)).toEqual([1, 2]);
    expect(committed).toEqual([2]);
  });
});
