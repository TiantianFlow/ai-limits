import { describe, expect, test, vi } from "vitest";

import type {
  ProviderId,
  ProviderRefreshOutcome,
  ProviderSnapshot,
} from "../domain/model";
import { readKimiPageAccessToken } from "./kimi-page";
import {
  createRefreshOrchestrator as createProductionRefreshOrchestrator,
  deriveRefreshPolicy,
  type ProviderRunControl,
  type RefreshOrchestratorDependencies,
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

function createRefreshOrchestrator(
  dependencies: Omit<
    RefreshOrchestratorDependencies,
    "isAutoRefreshEnabled" | "getBackoffRetryAt"
  > &
    Partial<
      Pick<
        RefreshOrchestratorDependencies,
        "isAutoRefreshEnabled" | "getBackoffRetryAt"
      >
    >,
) {
  return createProductionRefreshOrchestrator({
    isAutoRefreshEnabled: async () => true,
    getBackoffRetryAt: async () => undefined,
    ...dependencies,
  });
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
  test("bounds a non-settling provider and prevents its late result from committing", async () => {
    vi.useFakeTimers();
    const injection = deferred<Array<{ result?: unknown }>>();
    let control: ProviderRunControl | undefined;
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["kimi"],
      isProviderRefreshEligible: async () => true,
      runProvider: async (_providerId, _policy, nextControl) => {
        control = nextControl;
        await readKimiPageAccessToken(42, () => injection.promise);
        return success("kimi");
      },
      clock: () => NOW,
    });

    const report = orchestrator.refreshProvider("kimi", "manual_provider");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(control?.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(report).resolves.toMatchObject({
      providers: { kimi: { kind: "failure", category: "temporary_error" } },
    });
    expect(control?.signal.aborted).toBe(true);
    expect(control?.isCurrentGeneration()).toBe(false);

    injection.resolve([{ result: "late-token" }]);
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  test("runs one queued manual follow-up after scheduled work times out", async () => {
    vi.useFakeTimers();
    const passive = deferred<ProviderRefreshOutcome>();
    const policies: RefreshPolicy[] = [];
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["kimi"],
      isProviderRefreshEligible: async () => true,
      runProvider: async (_providerId, policy) => {
        policies.push(policy);
        return policy.interaction === "forbidden"
          ? passive.promise
          : success("kimi");
      },
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.advanceTimersByTimeAsync(0);
    const manual = orchestrator.refreshProvider("kimi", "manual_provider");
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(scheduled).resolves.toMatchObject({
      providers: { kimi: { kind: "failure", category: "temporary_error" } },
    });
    await expect(manual).resolves.toMatchObject({
      providers: { kimi: { kind: "success" } },
    });
    expect(policies.map(({ trigger }) => trigger)).toEqual([
      "scheduled",
      "manual_provider",
    ]);

    passive.resolve(success("kimi"));
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  test("defers scheduled work while stored backoff is active", async () => {
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isProviderRefreshEligible: async () => true,
      getBackoffRetryAt: async () => NOW + 60_000,
      runProvider,
      clock: () => NOW,
    });

    await expect(orchestrator.refreshAll("scheduled")).resolves.toMatchObject({
      providers: {
        chatgpt: {
          kind: "deferred",
          reason: "backoff",
          retryAt: NOW + 60_000,
        },
      },
    });
    expect(runProvider).not.toHaveBeenCalled();
  });

  test("manual work bypasses stored scheduled backoff", async () => {
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isProviderRefreshEligible: async () => true,
      getBackoffRetryAt: async () => NOW + 60_000,
      runProvider,
      clock: () => NOW,
    });

    await expect(
      orchestrator.refreshProvider("chatgpt", "manual_provider"),
    ).resolves.toMatchObject({ providers: { chatgpt: { kind: "success" } } });
    expect(runProvider).toHaveBeenCalledOnce();
  });

  test.each([
    {
      label: "backoff",
      outcome: {
        kind: "deferred",
        reason: "backoff",
        retryAt: NOW + 60_000,
      } satisfies ProviderRefreshOutcome,
    },
    {
      label: "signed out",
      outcome: {
        kind: "failure",
        category: "signed_out",
      } satisfies ProviderRefreshOutcome,
    },
    {
      label: "challenge blocked",
      outcome: {
        kind: "failure",
        category: "challenge_blocked",
      } satisfies ProviderRefreshOutcome,
    },
    {
      label: "provider changed",
      outcome: {
        kind: "failure",
        category: "provider_changed",
      } satisfies ProviderRefreshOutcome,
    },
  ])("does not add an interactive follow-up after $label", async ({ outcome }) => {
    const passive = deferred<ProviderRefreshOutcome>();
    const runProvider = vi.fn(async () => passive.promise);
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isProviderRefreshEligible: async () => true,
      runProvider,
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(runProvider).toHaveBeenCalledOnce());
    const manual = orchestrator.refreshProvider("chatgpt", "manual_provider");
    passive.resolve(outcome);

    await expect(Promise.all([scheduled, manual])).resolves.toEqual([
      expect.objectContaining({ providers: { chatgpt: outcome } }),
      expect.objectContaining({ providers: { chatgpt: outcome } }),
    ]);
    expect(runProvider).toHaveBeenCalledOnce();
  });

  test("invalidates scheduled ingress while its auto-refresh check is pending", async () => {
    const autoRefresh = deferred<boolean>();
    const isAutoRefreshEnabled = vi.fn(() => autoRefresh.promise);
    const hasPermission = vi.fn(async () => true);
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isAutoRefreshEnabled,
      isProviderRefreshEligible: hasPermission,
      runProvider,
      clock: () => NOW,
    });

    const staleRun = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(isAutoRefreshEnabled).toHaveBeenCalledOnce());
    orchestrator.invalidateAll();
    autoRefresh.resolve(true);

    await expect(staleRun).resolves.toMatchObject({
      providers: { chatgpt: { kind: "skipped", reason: "superseded" } },
    });
    expect(hasPermission).not.toHaveBeenCalled();
    expect(runProvider).not.toHaveBeenCalled();
  });

  test("skips scheduled providers before permission checks when auto-refresh is off", async () => {
    const hasPermission = vi.fn(async () => true);
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isAutoRefreshEnabled: async () => false,
      isProviderRefreshEligible: hasPermission,
      runProvider,
      clock: () => NOW,
    });

    await expect(orchestrator.refreshAll("scheduled")).resolves.toMatchObject({
      providers: {
        chatgpt: { kind: "skipped", reason: "auto_refresh_disabled" },
      },
    });
    expect(hasPermission).not.toHaveBeenCalled();
    expect(runProvider).not.toHaveBeenCalled();
  });

  test("omits providers whose catalog disables scheduled refresh", async () => {
    const isProviderRefreshEligible = vi.fn(async () => true);
    const runProvider = vi.fn(async (providerId: ProviderId) =>
      success(providerId),
    );
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt", "elevenlabs"],
      isScheduledRefreshEnabled: (providerId) => providerId !== "elevenlabs",
      isProviderRefreshEligible,
      runProvider,
      clock: () => NOW,
    });

    await expect(orchestrator.refreshAll("scheduled")).resolves.toEqual({
      trigger: "scheduled",
      startedAt: NOW,
      finishedAt: NOW,
      providers: { chatgpt: success("chatgpt") },
    });
    expect(isProviderRefreshEligible).toHaveBeenCalledOnce();
    expect(isProviderRefreshEligible).toHaveBeenCalledWith("chatgpt");
    expect(runProvider).toHaveBeenCalledOnce();
  });

  test("lets a manual request follow a disabled scheduled ingress", async () => {
    const autoRefresh = deferred<boolean>();
    const policies: RefreshPolicy[] = [];
    const hasPermission = vi.fn(async () => true);
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isAutoRefreshEnabled: () => autoRefresh.promise,
      isProviderRefreshEligible: hasPermission,
      runProvider: async (_providerId, policy) => {
        policies.push(policy);
        return success("chatgpt");
      },
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    const manual = orchestrator.refreshProvider("chatgpt", "manual_provider");
    autoRefresh.resolve(false);

    await expect(scheduled).resolves.toMatchObject({
      providers: {
        chatgpt: { kind: "skipped", reason: "auto_refresh_disabled" },
      },
    });
    await expect(manual).resolves.toMatchObject({
      providers: { chatgpt: { kind: "success" } },
    });
    expect(hasPermission).toHaveBeenCalledOnce();
    expect(policies).toEqual([deriveRefreshPolicy("manual_provider")]);
  });

  test("does not follow up a scheduled permission-required skip", async () => {
    const permission = deferred<boolean>();
    const hasPermission = vi.fn(() => permission.promise);
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isProviderRefreshEligible: hasPermission,
      runProvider,
      clock: () => NOW,
    });

    const scheduled = orchestrator.refreshAll("scheduled");
    await vi.waitFor(() => expect(hasPermission).toHaveBeenCalledOnce());
    const manual = orchestrator.refreshProvider("chatgpt", "manual_provider");
    permission.resolve(false);

    await expect(Promise.all([scheduled, manual])).resolves.toEqual([
      expect.objectContaining({
        providers: {
          chatgpt: { kind: "skipped", reason: "permission_required" },
        },
      }),
      expect.objectContaining({
        providers: {
          chatgpt: { kind: "skipped", reason: "permission_required" },
        },
      }),
    ]);
    expect(hasPermission).toHaveBeenCalledOnce();
    expect(runProvider).not.toHaveBeenCalled();
  });

  test("invalidates a provider while permission preflight is pending without starting collection", async () => {
    const permission = deferred<boolean>();
    const hasPermission = vi.fn(() => permission.promise);
    const runProvider = vi.fn(async () => success("chatgpt"));
    const orchestrator = createRefreshOrchestrator({
      providerIds: ["chatgpt"],
      isProviderRefreshEligible: hasPermission,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
      isProviderRefreshEligible: async () => true,
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
