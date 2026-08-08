import type {
  AppState,
  CreditBalance,
  DisplayMode,
  ProviderHealth,
  ProviderId,
  ProviderRecord,
  ProviderSnapshot,
  QuotaWindow,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalNumber(
  value: unknown,
  predicate: (value: number) => boolean,
): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && predicate(value));
}

function normalizeWindow(value: unknown): QuotaWindow | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !["rolling", "calendar", "model", "feature"].includes(
      value.kind as string,
    ) ||
    !isFiniteNumber(value.usedRatio) ||
    value.usedRatio < 0 ||
    value.usedRatio > 1 ||
    !isOptionalNumber(value.used, (number) => number >= 0) ||
    !isOptionalNumber(value.limit, (number) => number > 0) ||
    !isOptionalString(value.unit) ||
    !isOptionalNumber(value.startedAt, (number) => number >= 0) ||
    !isOptionalNumber(value.resetsAt, (number) => number >= 0) ||
    !isOptionalNumber(value.durationMs, (number) => number > 0) ||
    (value.sourceSemantics !== "used" && value.sourceSemantics !== "remaining") ||
    (isFiniteNumber(value.startedAt) &&
      isFiniteNumber(value.resetsAt) &&
      value.resetsAt <= value.startedAt)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    label: value.label,
    kind: value.kind as QuotaWindow["kind"],
    usedRatio: value.usedRatio,
    ...(value.used !== undefined ? { used: value.used } : {}),
    ...(value.limit !== undefined ? { limit: value.limit } : {}),
    ...(value.unit !== undefined ? { unit: value.unit } : {}),
    ...(value.startedAt !== undefined ? { startedAt: value.startedAt } : {}),
    ...(value.resetsAt !== undefined ? { resetsAt: value.resetsAt } : {}),
    ...(value.durationMs !== undefined ? { durationMs: value.durationMs } : {}),
    sourceSemantics: value.sourceSemantics,
  };
}

function normalizeCredit(value: unknown): CreditBalance | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.unit) ||
    !isOptionalNumber(value.used, (number) => number >= 0) ||
    !isOptionalNumber(value.limit, (number) => number > 0) ||
    !isOptionalNumber(value.remaining, (number) => number >= 0) ||
    !isOptionalNumber(value.resetsAt, (number) => number >= 0)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    label: value.label,
    unit: value.unit,
    ...(value.used !== undefined ? { used: value.used } : {}),
    ...(value.limit !== undefined ? { limit: value.limit } : {}),
    ...(value.remaining !== undefined ? { remaining: value.remaining } : {}),
    ...(value.resetsAt !== undefined ? { resetsAt: value.resetsAt } : {}),
  };
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
    !isFiniteNumber(value.fetchedAt) ||
    value.fetchedAt < 0 ||
    !isOptionalString(value.accountLabel) ||
    !isOptionalString(value.planLabel) ||
    !Array.isArray(value.windows) ||
    !Array.isArray(value.credits)
  ) {
    return undefined;
  }

  const windows = value.windows.map(normalizeWindow);
  const credits = value.credits.map(normalizeCredit);
  if (windows.some((window) => window === undefined) || credits.some((credit) => credit === undefined)) {
    return undefined;
  }

  return {
    providerId,
    ...(value.accountLabel !== undefined ? { accountLabel: value.accountLabel } : {}),
    ...(value.planLabel !== undefined ? { planLabel: value.planLabel } : {}),
    source: value.source,
    fetchedAt: value.fetchedAt,
    windows: windows as QuotaWindow[],
    credits: credits as CreditBalance[],
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
