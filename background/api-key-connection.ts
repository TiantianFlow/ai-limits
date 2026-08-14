import type {
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/instances";
import type { ProviderRefreshOutcome } from "../domain/model";
import type { ApiKeyConnectionStatus } from "../domain/public-protocol";
import type {
  ProviderPackage,
  ProviderRuntimeServices,
} from "../providers/types";
import { markCredentialRejectedIfRevision } from "../storage/credential-vault";
import { collectProviderOutcome } from "./coordinator";

export type { ApiKeyConnectionStatus } from "../domain/public-protocol";

export interface ApiKeyConnectionValidation {
  outcome: ProviderRefreshOutcome;
  finishedAt: number;
  result: ApiKeyConnectionStatus;
}

export interface ApiKeyConnectionLifecycle {
  connect(
    instance: ProviderInstanceRecord,
    providerPackage: ProviderPackage,
    apiKey: string,
    services: Omit<ProviderRuntimeServices, "signal">,
    clock?: () => number,
    isAllowed?: () => boolean,
  ): Promise<ApiKeyConnectionValidation>;
  invalidateInstance(instanceId: ProviderInstanceId): void;
  invalidateAll(): void;
}

interface ActiveConnection {
  controller: AbortController;
  generation: number;
}

function connectionStatus(
  outcome: ProviderRefreshOutcome,
): ApiKeyConnectionStatus {
  if (outcome.kind === "success") return "connected";
  if (outcome.kind === "failure") {
    if (outcome.category === "credential_invalid") return "invalid_key";
    if (outcome.category === "credential_scope_required") {
      return "insufficient_scope";
    }
    if (outcome.category === "provider_changed") return "invalid_site";
  }
  return "temporary_error";
}

export function createApiKeyConnectionLifecycle(): ApiKeyConnectionLifecycle {
  const activeConnections = new Map<ProviderInstanceId, ActiveConnection>();
  const generations = new Map<ProviderInstanceId, number>();

  const invalidateInstance = (instanceId: ProviderInstanceId): void => {
    const generation = (generations.get(instanceId) ?? 0) + 1;
    generations.set(instanceId, generation);
    activeConnections.get(instanceId)?.controller.abort();
    activeConnections.delete(instanceId);
  };

  return {
    async connect(
      instance,
      providerPackage,
      apiKey,
      services,
      clock = Date.now,
      isAllowed = () => true,
    ) {
      invalidateInstance(instance.id);
      const generation = generations.get(instance.id) ?? 0;
      const controller = new AbortController();
      activeConnections.set(instance.id, { controller, generation });
      const isCurrent = () =>
        activeConnections.get(instance.id)?.generation === generation &&
        generations.get(instance.id) === generation &&
        !controller.signal.aborted &&
        isAllowed();
      try {
        const collected = await collectProviderOutcome(
          providerPackage,
          instance,
          { ...services, signal: controller.signal },
          "connect",
          { kind: "api-key", value: apiKey },
          clock,
        );
        const outcome = isCurrent()
          ? collected.outcome
          : ({ kind: "skipped", reason: "superseded" } as const);
        return {
          outcome,
          finishedAt: collected.finishedAt,
          result: connectionStatus(outcome),
        };
      } finally {
        if (isCurrent()) activeConnections.delete(instance.id);
      }
    },
    invalidateInstance,
    invalidateAll() {
      for (const instanceId of [...activeConnections.keys()]) {
        invalidateInstance(instanceId);
      }
    },
  };
}

export async function markStoredApiKeyRejectedForOutcome(
  instanceId: ProviderInstanceId,
  expectedRevision: string,
  outcome: ProviderRefreshOutcome,
): Promise<void> {
  if (
    outcome.kind === "failure" &&
    outcome.category === "credential_invalid"
  ) {
    await markCredentialRejectedIfRevision(instanceId, expectedRevision);
  }
}
