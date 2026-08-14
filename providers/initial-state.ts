import { sanitizedFailureMessage } from "../domain/model";
import {
  observationFromSnapshot,
  retainQuotaHistory,
} from "../domain/history";
import type {
  AppState,
  CreditBalance,
  DisplayMode,
  LegacyUsageGroup,
  ProviderAttempt,
  ProviderId,
  ProviderRecord,
  ProviderSnapshot,
  QuotaHistoryObservation,
  QuotaHistorySample,
  QuotaSegment,
  QuotaWindow,
} from "../domain/model";
import { providerIds } from "./catalog";

export const CURRENT_STATE_VERSION = 4 as const;
const SEGMENT_SUM_TOLERANCE = 1e-6;

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

function normalizeSegments(
  value: unknown,
  totalUsedRatio: number,
): QuotaSegment[] | undefined {
  if (value === undefined || !Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const segments = value.map((segment): QuotaSegment | undefined => {
    if (
      !isRecord(segment) ||
      !isNonEmptyString(segment.id) ||
      !isNonEmptyString(segment.label) ||
      !isFiniteNumber(segment.usedRatio) ||
      segment.usedRatio < 0 ||
      segment.usedRatio > 1
    ) {
      return undefined;
    }

    return {
      id: segment.id,
      label: segment.label,
      usedRatio: segment.usedRatio,
    };
  });

  if (
    segments.some((segment) => segment === undefined) ||
    new Set(segments.map((segment) => segment?.id)).size !== segments.length
  ) {
    return undefined;
  }

  const sum = (segments as QuotaSegment[]).reduce(
    (total, segment) => total + segment.usedRatio,
    0,
  );
  return Math.abs(sum - totalUsedRatio) <= SEGMENT_SUM_TOLERANCE
    ? (segments as QuotaSegment[])
    : undefined;
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

  const segments = normalizeSegments(value.segments, value.usedRatio);

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
    ...(segments === undefined ? {} : { segments }),
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

function normalizeUsageGroups(
  value: unknown,
  windows: readonly QuotaWindow[],
  credits: readonly CreditBalance[],
): LegacyUsageGroup[] | undefined {
  if (value === undefined || !Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const groups = value.map((group): LegacyUsageGroup | undefined => {
    if (
      !isRecord(group) ||
      !isNonEmptyString(group.id) ||
      !isNonEmptyString(group.label) ||
      !isOptionalString(group.description) ||
      !Array.isArray(group.windowIds) ||
      !Array.isArray(group.creditIds) ||
      !group.windowIds.every(isNonEmptyString) ||
      !group.creditIds.every(isNonEmptyString) ||
      (group.windowIds.length === 0 && group.creditIds.length === 0)
    ) {
      return undefined;
    }

    return {
      id: group.id,
      label: group.label,
      ...(group.description === undefined ? {} : { description: group.description }),
      windowIds: group.windowIds,
      creditIds: group.creditIds,
    };
  });

  if (
    groups.some((group) => group === undefined) ||
    new Set(groups.map((group) => group?.id)).size !== groups.length
  ) {
    return undefined;
  }

  const measureIds = new Set([
    ...windows.map((window) => `window:${window.id}`),
    ...credits.map((credit) => `credit:${credit.id}`),
  ]);
  const memberships = (groups as LegacyUsageGroup[]).flatMap((group) => [
    ...group.windowIds.map((id) => `window:${id}`),
    ...group.creditIds.map((id) => `credit:${id}`),
  ]);

  if (
    memberships.some((membership) => !measureIds.has(membership)) ||
    new Set(memberships).size !== memberships.length
  ) {
    return undefined;
  }

  return groups as LegacyUsageGroup[];
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeProviderSnapshot(
  value: unknown,
  providerId: ProviderId,
): ProviderSnapshot | undefined {
  if (
    !isRecord(value) ||
    value.providerId !== providerId ||
    (value.source !== "web-session" &&
      value.source !== "oauth" &&
      value.source !== "api-key") ||
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
    credits.some((credit) => credit === undefined) ||
    new Set(windows.map((window) => window?.id)).size !== windows.length ||
    new Set(credits.map((credit) => credit?.id)).size !== credits.length
  ) {
    return undefined;
  }

  const usageGroups = normalizeUsageGroups(
    value.usageGroups,
    windows as QuotaWindow[],
    credits as CreditBalance[],
  );

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
    ...(usageGroups === undefined ? {} : { usageGroups }),
  };
}

function normalizeHistorySample(value: unknown): QuotaHistorySample | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.windowId) ||
    !isFiniteNumber(value.usedRatio) ||
    value.usedRatio < 0 ||
    value.usedRatio > 1 ||
    !isOptionalNumber(value.startedAt, (number) => number >= 0) ||
    !isOptionalNumber(value.resetsAt, (number) => number >= 0) ||
    !isOptionalNumber(value.durationMs, (number) => number > 0) ||
    (isFiniteNumber(value.startedAt) &&
      isFiniteNumber(value.resetsAt) &&
      value.resetsAt <= value.startedAt)
  ) {
    return undefined;
  }

  return {
    windowId: value.windowId,
    usedRatio: value.usedRatio,
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
    ...(value.resetsAt === undefined ? {} : { resetsAt: value.resetsAt }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
  };
}

function normalizeHistoryObservation(
  value: unknown,
): QuotaHistoryObservation | undefined {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.observedAt) ||
    value.observedAt < 0 ||
    !Array.isArray(value.windows)
  ) {
    return undefined;
  }

  const windows = value.windows.map(normalizeHistorySample);
  if (
    windows.some((window) => window === undefined) ||
    new Set(windows.map((window) => window?.windowId)).size !== windows.length
  ) {
    return undefined;
  }

  return {
    observedAt: value.observedAt,
    windows: windows as QuotaHistorySample[],
  };
}

function normalizeHistory(value: unknown): QuotaHistoryObservation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byTimestamp = new Map<number, QuotaHistoryObservation>();
  for (const candidate of value) {
    const observation = normalizeHistoryObservation(candidate);
    if (observation) {
      byTimestamp.set(observation.observedAt, observation);
    }
  }

  return [...byTimestamp.values()].sort(
    (left, right) => left.observedAt - right.observedAt,
  );
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
      "credential_invalid",
      "credential_scope_required",
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
              value.message,
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
    value.version === CURRENT_STATE_VERSION &&
    isRecord(value.preferences) &&
    typeof value.preferences.autoRefresh === "boolean"
    ? value.preferences.autoRefresh
    : true;
}

function normalizedAccess(
  root: unknown,
  stored: Record<string, unknown>,
): ProviderRecord["access"] {
  if (
    isRecord(root) &&
    (root.version === 3 || root.version === CURRENT_STATE_VERSION)
  ) {
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
    providers: providerIds.map((providerId) => ({
      providerId,
      access: "required",
      history: [],
    })),
  };
}

export function migrateState(value: unknown, now: number): AppState {
  const storedProviders =
    isRecord(value) && Array.isArray(value.providers) ? value.providers : [];

  const providers: ProviderRecord[] = providerIds.map((providerId) => {
    const stored = storedProviders.find(
      (candidate) => isRecord(candidate) && candidate.providerId === providerId,
    );

    if (!isRecord(stored)) {
      return { providerId, access: "required", history: [] };
    }

    const snapshot = normalizeProviderSnapshot(stored.snapshot, providerId);
    const lastAttempt = normalizeAttempt(stored.lastAttempt);
    const history =
      isRecord(value) && value.version === CURRENT_STATE_VERSION
        ? retainQuotaHistory(normalizeHistory(stored.history), now)
        : isRecord(value) && value.version === 3 && snapshot
          ? retainQuotaHistory([observationFromSnapshot(snapshot)], now)
          : [];

    return {
      providerId,
      access: normalizedAccess(value, stored),
      history,
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
