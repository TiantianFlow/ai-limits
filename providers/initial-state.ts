import type {
  AppState,
  DisplayMode,
  ProviderHealth,
  ProviderId,
  ProviderRecord,
  ProviderSnapshot,
} from "../domain/model";

export const CURRENT_STATE_VERSION = 2 as const;

const PROVIDER_IDS: ProviderId[] = [
  "chatgpt",
  "claude",
  "kimi",
  "cursor",
  "antigravity",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function initialHealth(providerId: ProviderId): ProviderHealth {
  return providerId === "antigravity"
    ? {
        kind: "experimental_unavailable",
        message: "Usage data is not available yet.",
      }
    : { kind: "permission_required" };
}

function normalizeHealth(value: unknown): ProviderHealth | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  const message = typeof value.message === "string" ? value.message : undefined;

  switch (value.kind) {
    case "permission_required":
    case "connecting":
    case "connected":
      return { kind: value.kind };
    case "signed_out":
    case "challenge_blocked":
    case "provider_changed":
      return { kind: value.kind, ...(message ? { message } : {}) };
    case "temporary_error":
      return {
        kind: value.kind,
        ...(message ? { message } : {}),
        ...(typeof value.retryAt === "number" ? { retryAt: value.retryAt } : {}),
      };
    case "experimental_unavailable":
      return { kind: value.kind, ...(message ? { message } : {}) };
    default:
      return undefined;
  }
}

function normalizeSnapshot(
  value: unknown,
  providerId: ProviderId,
): ProviderSnapshot | undefined {
  if (
    !isRecord(value) ||
    value.providerId !== providerId ||
    (value.source !== "web-session" && value.source !== "oauth") ||
    typeof value.fetchedAt !== "number" ||
    !Array.isArray(value.windows) ||
    !Array.isArray(value.credits)
  ) {
    return undefined;
  }

  return {
    ...(value as unknown as ProviderSnapshot),
    providerId,
  };
}

function displayMode(value: unknown): DisplayMode {
  if (
    isRecord(value) &&
    isRecord(value.preferences) &&
    (value.preferences.displayMode === "used" ||
      value.preferences.displayMode === "left")
  ) {
    return value.preferences.displayMode;
  }

  return "used";
}

export function createInitialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    preferences: { displayMode: "used" },
    providers: PROVIDER_IDS.map((providerId) => ({
      providerId,
      health: initialHealth(providerId),
    })),
  };
}

export function migrateState(value: unknown): AppState {
  const storedProviders =
    isRecord(value) && Array.isArray(value.providers) ? value.providers : [];

  const providers: ProviderRecord[] = PROVIDER_IDS.map((providerId) => {
    const stored = storedProviders.find(
      (candidate) => isRecord(candidate) && candidate.providerId === providerId,
    );

    if (!isRecord(stored)) {
      return { providerId, health: initialHealth(providerId) };
    }

    const snapshot = normalizeSnapshot(stored.snapshot, providerId);
    const health = normalizeHealth(stored.health);

    if (providerId === "antigravity") {
      return {
        providerId,
        ...(snapshot ? { snapshot } : {}),
        health: snapshot && health ? health : initialHealth(providerId),
      };
    }

    if (snapshot) {
      return {
        providerId,
        snapshot,
        health: health ?? { kind: "connected" },
      };
    }

    const retainedFailure =
      health &&
      [
        "permission_required",
        "signed_out",
        "challenge_blocked",
        "provider_changed",
        "temporary_error",
      ].includes(health.kind)
        ? health
        : initialHealth(providerId);

    return { providerId, health: retainedFailure };
  });

  return {
    version: CURRENT_STATE_VERSION,
    preferences: { displayMode: displayMode(value) },
    providers,
  };
}
