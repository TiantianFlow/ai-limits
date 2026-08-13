import type {
  AppState,
  ProviderRefreshOutcome,
  RefreshReport,
} from "../domain/model";
import type { ApiKeyProviderId } from "../providers/catalog";
import { providerRegistry } from "../providers/registry";
import type { CollectionContext } from "../providers/types";
import {
  markProviderCredentialRejectedIfRevision,
  restoreProviderCredentialIfRevision,
  saveProviderApiKeyIfCurrent,
} from "../storage/credentials";
import { ensureState } from "../storage/repository";
import {
  collectProviderOutcome,
  commitProviderOutcome,
} from "./coordinator";

const MAX_API_KEY_LENGTH = 4_096;

export type ApiKeyConnectionStatus =
  | "connected"
  | "invalid_key"
  | "insufficient_scope"
  | "temporary_error";

export interface ApiKeyConnectionResult {
  state: AppState;
  report: RefreshReport;
  result: ApiKeyConnectionStatus;
}

export interface ApiKeyConnectionLifecycle {
  connect(
    providerId: ApiKeyProviderId,
    apiKey: string,
    context: Omit<CollectionContext, "credential" | "signal">,
    clock?: () => number,
    isAllowed?: () => boolean,
  ): Promise<ApiKeyConnectionResult>;
  invalidateProvider(providerId: ApiKeyProviderId): void;
  invalidateAll(): void;
}

interface ActiveConnection {
  controller: AbortController;
  generation: number;
}

export function createApiKeyConnectionLifecycle(): ApiKeyConnectionLifecycle {
  const activeConnections = new Map<ApiKeyProviderId, ActiveConnection>();
  const generations = new Map<ApiKeyProviderId, number>();

  const invalidateProvider = (providerId: ApiKeyProviderId): void => {
    const generation = (generations.get(providerId) ?? 0) + 1;
    generations.set(providerId, generation);
    activeConnections.get(providerId)?.controller.abort();
    activeConnections.delete(providerId);
  };

  return {
    async connect(
      providerId,
      apiKey,
      context,
      clock = Date.now,
      isAllowed = () => true,
    ) {
      invalidateProvider(providerId);
      const generation = generations.get(providerId) ?? 0;
      const controller = new AbortController();
      activeConnections.set(providerId, { controller, generation });
      const isCurrent = () =>
        activeConnections.get(providerId)?.generation === generation &&
        generations.get(providerId) === generation &&
        isAllowed();

      try {
        return await connectApiKeyProvider(
          providerId,
          apiKey,
          { ...context, signal: controller.signal },
          isCurrent,
          clock,
        );
      } finally {
        if (isCurrent()) {
          activeConnections.delete(providerId);
        }
      }
    },
    invalidateProvider,
    invalidateAll() {
      for (const providerId of [...activeConnections.keys()]) {
        invalidateProvider(providerId);
      }
    },
  };
}

function connectionStatus(
  outcome: ProviderRefreshOutcome,
): ApiKeyConnectionStatus {
  if (outcome.kind === "success") {
    return "connected";
  }

  if (outcome.kind === "failure") {
    if (outcome.category === "credential_invalid") {
      return "invalid_key";
    }
    if (outcome.category === "credential_scope_required") {
      return "insufficient_scope";
    }
  }

  return "temporary_error";
}

export async function connectApiKeyProvider(
  providerId: ApiKeyProviderId,
  apiKey: string,
  context: Omit<CollectionContext, "credential">,
  shouldCommit: () => boolean = () => true,
  clock: () => number = Date.now,
): Promise<ApiKeyConnectionResult> {
  try {
    const normalizedApiKey = apiKey.trim();
    if (
      normalizedApiKey.length === 0 ||
      apiKey.length > MAX_API_KEY_LENGTH
    ) {
      throw new Error("Invalid API key.");
    }

    const adapter = providerRegistry[providerId];
    const collected = await collectProviderOutcome(
      adapter,
      {
        ...context,
        credential: { kind: "api-key", value: normalizedApiKey },
      },
      "connect",
      clock,
    );
    let outcome = collected.outcome;

    if (!shouldCommit()) {
      outcome = { kind: "skipped", reason: "superseded" };
    } else if (outcome.kind === "success") {
      const saveResult = await saveProviderApiKeyIfCurrent(
        providerId,
        normalizedApiKey,
        shouldCommit,
      );
      if (!saveResult.saved) {
        outcome = { kind: "skipped", reason: "superseded" };
      } else {
        try {
          outcome = await commitProviderOutcome(
            adapter,
            outcome,
            "connect",
            context.now,
            collected.finishedAt,
            shouldCommit,
          );
          if (
            outcome.kind === "skipped" &&
            outcome.reason === "superseded"
          ) {
            await restoreProviderCredentialIfRevision(
              providerId,
              saveResult.revision,
              saveResult.previous,
            );
          }
        } catch (error) {
          await restoreProviderCredentialIfRevision(
            providerId,
            saveResult.revision,
            saveResult.previous,
          );
          throw error;
        }
      }
    }

    const state = await ensureState(collected.finishedAt);
    return {
      state,
      report: {
        trigger: "connect",
        startedAt: context.now,
        finishedAt: collected.finishedAt,
        providers: { [providerId]: outcome },
      },
      result: connectionStatus(outcome),
    };
  } catch {
    throw new Error("API key connection failed.");
  }
}

export async function markStoredApiKeyRejectedForOutcome(
  providerId: ApiKeyProviderId,
  expectedRevision: string,
  outcome: ProviderRefreshOutcome,
): Promise<void> {
  if (
    outcome.kind === "failure" &&
    outcome.category === "credential_invalid"
  ) {
    await markProviderCredentialRejectedIfRevision(
      providerId,
      expectedRevision,
    );
  }
}
