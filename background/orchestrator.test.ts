import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceId } from "../domain/instances";
import type { ProviderRefreshOutcome } from "../domain/model";
import {
  createRefreshOrchestrator,
  deriveRefreshPolicy,
  type ProviderRunControl,
} from "./orchestrator";

const FIRST = "newapi:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "newapi:550e8400-e29b-41d4-a716-446655440001";
const KIMI = "kimi:default";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function success(instanceId: ProviderInstanceId): ProviderRefreshOutcome {
  return {
    kind: "success",
    snapshot: {
      providerKind: instanceId.startsWith("kimi:") ? "kimi" : "newapi",
      source: instanceId.startsWith("kimi:") ? "web-session" : "api-key",
      fetchedAt: 1,
      metrics: [],
    },
  };
}

describe("instance refresh orchestrator", () => {
  test("derives interaction only from the trigger policy", () => {
    expect(deriveRefreshPolicy("scheduled").interaction).toBe("forbidden");
    expect(deriveRefreshPolicy("connect").interaction).toBe("allowed");
    expect(deriveRefreshPolicy("manual_provider").interaction).toBe("allowed");
    expect(deriveRefreshPolicy("manual_all").interaction).toBe("allowed");
  });

  test("refresh-all enumerates current instances and preserves repository order", async () => {
    const instances = [FIRST, SECOND, KIMI];
    const completions = new Map(instances.map((id) => [id, deferred<ProviderRefreshOutcome>()]));
    const runProvider = vi.fn((instanceId: ProviderInstanceId) =>
      completions.get(instanceId)!.promise,
    );
    const orchestrator = createRefreshOrchestrator({
      listInstanceIds: async () => instances,
      isAutoRefreshEnabled: async () => true,
      isInstanceRefreshEligible: async () => true,
      getBackoffRetryAt: async () => undefined,
      runProvider,
      clock: vi.fn().mockReturnValueOnce(10).mockReturnValue(20),
    });

    const reportPromise = orchestrator.refreshAll("manual_all");
    completions.get(SECOND)!.resolve(success(SECOND));
    completions.get(KIMI)!.resolve(success(KIMI));
    completions.get(FIRST)!.resolve(success(FIRST));

    await expect(reportPromise).resolves.toMatchObject({
      trigger: "manual_all",
      startedAt: 10,
      finishedAt: 20,
      results: [
        { instanceId: FIRST },
        { instanceId: SECOND },
        { instanceId: KIMI },
      ],
    });
    expect(runProvider).toHaveBeenCalledTimes(3);
  });

  test("same-kind siblings have independent active runs and generations", async () => {
    const firstRun = deferred<ProviderRefreshOutcome>();
    const secondRun = deferred<ProviderRefreshOutcome>();
    const controls = new Map<ProviderInstanceId, ProviderRunControl>();
    const runProvider = vi.fn(
      (
        instanceId: ProviderInstanceId,
        _policy: unknown,
        control: ProviderRunControl,
      ) => {
        controls.set(instanceId, control);
        return instanceId === FIRST ? firstRun.promise : secondRun.promise;
      },
    );
    const orchestrator = createRefreshOrchestrator({
      listInstanceIds: async () => [FIRST, SECOND],
      isAutoRefreshEnabled: async () => true,
      isInstanceRefreshEligible: async () => true,
      getBackoffRetryAt: async () => undefined,
      runProvider,
    });

    const firstReport = orchestrator.refreshInstance(FIRST, "manual_provider");
    const secondReport = orchestrator.refreshInstance(SECOND, "manual_provider");
    await vi.waitFor(() => expect(runProvider).toHaveBeenCalledTimes(2));
    orchestrator.invalidateInstance(FIRST);

    expect(controls.get(FIRST)?.isCurrentGeneration()).toBe(false);
    expect(controls.get(SECOND)?.isCurrentGeneration()).toBe(true);
    secondRun.resolve(success(SECOND));
    firstRun.resolve(success(FIRST));

    await expect(firstReport).resolves.toMatchObject({
      results: [{ instanceId: FIRST, outcome: { kind: "skipped", reason: "superseded" } }],
    });
    await expect(secondReport).resolves.toMatchObject({
      results: [{ instanceId: SECOND, outcome: { kind: "success" } }],
    });
  });

  test("backoff is isolated by instance and manual refresh bypasses it", async () => {
    const runProvider = vi.fn(async (instanceId: ProviderInstanceId) => success(instanceId));
    const retryAt = vi.fn(async (instanceId: ProviderInstanceId) =>
      instanceId === FIRST ? 2_000 : undefined,
    );
    const orchestrator = createRefreshOrchestrator({
      listInstanceIds: async () => [FIRST, SECOND],
      isAutoRefreshEnabled: async () => true,
      isInstanceRefreshEligible: async () => true,
      getBackoffRetryAt: retryAt,
      runProvider,
      clock: () => 1_000,
    });

    await expect(orchestrator.refreshAll("scheduled")).resolves.toMatchObject({
      results: [
        { instanceId: FIRST, outcome: { kind: "deferred", reason: "backoff", retryAt: 2_000 } },
        { instanceId: SECOND, outcome: { kind: "success" } },
      ],
    });
    expect(runProvider).toHaveBeenCalledTimes(1);
    expect(runProvider).toHaveBeenCalledWith(SECOND, expect.anything(), expect.anything());

    await orchestrator.refreshInstance(FIRST, "manual_provider");
    expect(runProvider).toHaveBeenCalledWith(FIRST, expect.anything(), expect.anything());
  });

  test("scheduled refresh gives Kimi a forbidden interaction policy", async () => {
    const runProvider = vi.fn(async (_id: ProviderInstanceId) => success(KIMI));
    const orchestrator = createRefreshOrchestrator({
      listInstanceIds: async () => [KIMI],
      isAutoRefreshEnabled: async () => true,
      isInstanceRefreshEligible: async () => true,
      isScheduledRefreshEnabled: async () => true,
      getBackoffRetryAt: async () => undefined,
      runProvider,
    });

    await orchestrator.refreshAll("scheduled");

    expect(runProvider).toHaveBeenCalledWith(
      KIMI,
      expect.objectContaining({ trigger: "scheduled", interaction: "forbidden" }),
      expect.anything(),
    );
  });

  test("coalesces duplicate work only within one instance", async () => {
    const completion = deferred<ProviderRefreshOutcome>();
    const runProvider = vi.fn(() => completion.promise);
    const orchestrator = createRefreshOrchestrator({
      listInstanceIds: async () => [FIRST],
      isAutoRefreshEnabled: async () => true,
      isInstanceRefreshEligible: async () => true,
      getBackoffRetryAt: async () => undefined,
      runProvider,
    });

    const one = orchestrator.refreshInstance(FIRST, "manual_provider");
    const two = orchestrator.refreshInstance(FIRST, "manual_provider");
    await vi.waitFor(() => expect(runProvider).toHaveBeenCalledTimes(1));
    completion.resolve(success(FIRST));

    await Promise.all([one, two]);
    expect(runProvider).toHaveBeenCalledTimes(1);
  });
});
