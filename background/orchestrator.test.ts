import { describe, expect, test, vi } from "vitest";

import type {
  ProviderId,
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
  test("invalidates a provider while permission preflight is pending without starting collection", async () => {
    const permission = deferred<boolean>();
    const hasPermission = vi.fn(() => permission.promise);
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      hasPermission,
      runProvider,
      clock: () => NOW,
    });

    const staleRun = orchestrator.refreshProvider("chatgpt", "manual_provider");
    await vi.waitFor(() => expect(hasPermission).toHaveBeenCalledOnce());
    orchestrator.invalidateProvider("chatgpt");
    permission.resolve(true);

    await expect(staleRun).resolves.toMatchObject({
      providers: { chatgpt: { kind: "skipped", reason: "superseded" } },
    });
    expect(runProvider).not.toHaveBeenCalled();
  });

  test("invalidates active provider work before privacy cleanup and permits a fresh run", async () => {
    const pending = deferred<ProviderRefreshOutcome>();
    const controls: ProviderRunControl[] = [];
    const runProvider = vi.fn(
      async (_providerId: ProviderId, _policy: RefreshPolicy, control: ProviderRunControl) => {
        controls.push(control);
        return controls.length === 1 ? pending.promise : success("chatgpt");
      },
    );
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      hasPermission: async () => true,
      runProvider,
      clock: () => NOW,
    });

    const staleRun = orchestrator.refreshProvider("chatgpt", "manual_provider");
    await vi.waitFor(() => expect(controls).toHaveLength(1));

    orchestrator.invalidateProvider("chatgpt");
    expect(controls[0]!.isCurrentGeneration()).toBe(false);
    expect(controls[0]!.signal.aborted).toBe(true);

    const freshRun = orchestrator.refreshProvider("chatgpt", "manual_provider");
    await expect(freshRun).resolves.toMatchObject({
      providers: { chatgpt: { kind: "success" } },
    });
    expect(runProvider).toHaveBeenCalledTimes(2);

    pending.resolve(success("chatgpt"));
    await staleRun;
  });

  test("invalidates a queued interactive follow-up before it can start collection", async () => {
    const passive = deferred<ProviderRefreshOutcome>();
    const runProvider = vi.fn(async () => passive.promise);
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["kimi"],
      hasPermission: async () => true,
      runProvider,
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(runProvider).toHaveBeenCalledOnce());
    const manual = orchestrator.refreshProvider("kimi", "manual_provider");
    orchestrator.invalidateProvider("kimi");
    passive.resolve({ kind: "deferred", reason: "session_required" });

    await expect(manual).resolves.toMatchObject({
      providers: { kimi: { kind: "skipped", reason: "superseded" } },
    });
    await scheduled;
    expect(runProvider).toHaveBeenCalledOnce();
  });

  test("invalidates active work for every provider before delete-all cleanup", async () => {
    const chatgpt = deferred<ProviderRefreshOutcome>();
    const kimi = deferred<ProviderRefreshOutcome>();
    const controls = new Map<string, ProviderRunControl>();
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt", "kimi"],
      hasPermission: async () => true,
      runProvider: async (providerId, _policy, control) => {
        controls.set(providerId, control);
        return providerId === "chatgpt" ? chatgpt.promise : kimi.promise;
      },
      clock: () => NOW,
    });

    const staleRun = orchestrator.refreshAll("manual_all");
    await vi.waitFor(() => expect(controls.size).toBe(2));

    orchestrator.invalidateAll();
    expect([...controls.values()].every((control) => !control.isCurrentGeneration())).toBe(true);
    expect([...controls.values()].every((control) => control.signal.aborted)).toBe(true);

    chatgpt.resolve(success("chatgpt"));
    kimi.resolve(success("kimi"));
    await staleRun;
  });

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

  test("makes the older generation stale before an interactive follow-up runs", async () => {
    const passive = deferred<ProviderRefreshOutcome>();
    const interactive = deferred<ProviderRefreshOutcome>();
    const controls: ProviderRunControl[] = [];
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

    expect(controls.map(({ generation }) => generation)).toEqual([1, 2]);
    expect(controls[0]!.isCurrentGeneration()).toBe(false);
    expect(controls[1]!.isCurrentGeneration()).toBe(true);

    interactive.resolve(success("kimi"));
    await Promise.all([scheduled, manual]);
  });
});
