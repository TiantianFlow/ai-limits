import { sanitizedFailureMessage } from "../domain/model";
import type {
  AppState,
  CreditBalance,
  DisplayMode,
  ProviderAttempt,
  ProviderId,
  ProviderRecord,
  ProviderSnapshot,
  QuotaWindow,
} from "../domain/model";

export const CURRENT_STATE_VERSION = 3 as const;

const PROVIDER_IDS: ProviderId[] = [
  "chatgpt",
  "claude",
  "kimi",
  "cursor",
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

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
  if (
    windows.some((window) => window === undefined) ||
    credits.some((credit) => credit === undefined)
  ) {
    return undefined;
  }

  return {
    providerId,
    ...(value.accountLabel !== undefined && !looksLikeEmail(value.accountLabel)
      ? { accountLabel: value.accountLabel }
      : {}),
    ...(value.planLabel !== undefined ? { planLabel: value.planLabel } : {}),
    source: value.source,
    fetchedAt: value.fetchedAt,
    windows: windows as QuotaWindow[],
    credits: credits as CreditBalance[],
  };
}

function normalizeAttemptOutcome(
  value: unknown,
): ProviderAttempt["outcome"] | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "success") {
    return { kind: "success" };
  }

  if (
    value.kind === "deferred" &&
    (value.reason === "session_required" || value.reason === "backoff") &&
    isOptionalNumber(value.retryAt, (number) => number >= 0)
  ) {
    return {
      kind: "deferred",
      reason: value.reason,
      ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
    };
  }

  if (
    value.kind === "failure" &&
    [
      "signed_out",
      "challenge_blocked",
      "provider_changed",
      "temporary_error",
    ].includes(value.category as string) &&
    isOptionalString(value.message) &&
    isOptionalNumber(value.retryAt, (number) => number >= 0)
  ) {
    return {
      kind: "failure",
      category: value.category as Extract<
        ProviderAttempt["outcome"],
        { kind: "failure" }
      >["category"],
      ...(value.message === undefined
        ? {}
        : {
            message: sanitizedFailureMessage(
              value.category as Extract<
                ProviderAttempt["outcome"],
                { kind: "failure" }
              >["category"],
            ),
          }),
      ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
    };
  }

  return undefined;
}

function normalizeAttempt(value: unknown): ProviderAttempt | undefined {
  if (
    !isRecord(value) ||
    !["connect", "manual_provider", "manual_all", "scheduled"].includes(
      value.trigger as string,
    ) ||
    !isFiniteNumber(value.startedAt) ||
    value.startedAt < 0 ||
    !isFiniteNumber(value.finishedAt) ||
    value.finishedAt < value.startedAt
  ) {
    return undefined;
  }

  const outcome = normalizeAttemptOutcome(value.outcome);
  if (!outcome) {
    return undefined;
  }

  return {
    trigger: value.trigger as ProviderAttempt["trigger"],
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    outcome,
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

function autoRefresh(value: unknown): boolean {
  return isRecord(value) &&
    isRecord(value.preferences) &&
    typeof value.preferences.autoRefresh === "boolean"
    ? value.preferences.autoRefresh
    : true;
}

function normalizedAccess(
  root: unknown,
  stored: Record<string, unknown>,
): ProviderRecord["access"] {
  if (isRecord(root) && root.version === CURRENT_STATE_VERSION) {
    return stored.access === "granted" ? "granted" : "required";
  }

  return isRecord(stored.health) && stored.health.kind === "permission_required"
    ? "required"
    : "granted";
}

export function createInitialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    preferences: { displayMode: "used", autoRefresh: true },
    providers: PROVIDER_IDS.map((providerId) => ({
      providerId,
      access: "required",
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
      return { providerId, access: "required" };
    }

    const snapshot = normalizeSnapshot(stored.snapshot, providerId);
    const lastAttempt = normalizeAttempt(stored.lastAttempt);

    return {
      providerId,
      access: normalizedAccess(value, stored),
      ...(snapshot ? { snapshot } : {}),
      ...(lastAttempt ? { lastAttempt } : {}),
    };
  });

  return {
    version: CURRENT_STATE_VERSION,
    preferences: {
      displayMode: displayMode(value),
      autoRefresh: autoRefresh(value),
    },
    providers,
  };
}
