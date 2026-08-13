import type { ProviderId } from "../providers/catalog";

export type { ProviderId } from "../providers/catalog";

export type DisplayMode = "used" | "left";

export interface QuotaSegment {
  id: string;
  label: string;
  usedRatio: number;
}

export interface QuotaWindow {
  id: string;
  label: string;
  kind: "rolling" | "calendar" | "model" | "feature";
  usedRatio: number;
  used?: number;
  limit?: number;
  unit?: string;
  startedAt?: number;
  resetsAt?: number;
  durationMs?: number;
  sourceSemantics: "used" | "remaining";
  segments?: QuotaSegment[];
}

export interface CreditBalance {
  id: string;
  label: string;
  unit: string;
  used?: number;
  limit?: number;
  remaining?: number;
  resetsAt?: number;
}

export interface UsageGroup {
  id: string;
  label: string;
  description?: string;
  windowIds: string[];
  creditIds: string[];
}

export interface ProviderSnapshot {
  providerId: ProviderId;
  accountLabel?: string;
  planLabel?: string;
  source: "web-session" | "oauth" | "api-key" | "fixture";
  fetchedAt: number;
  windows: QuotaWindow[];
  credits: CreditBalance[];
  usageGroups?: UsageGroup[];
}

export interface QuotaHistorySample {
  windowId: string;
  usedRatio: number;
  startedAt?: number;
  resetsAt?: number;
  durationMs?: number;
}

export interface QuotaHistoryObservation {
  observedAt: number;
  windows: QuotaHistorySample[];
}

export type RefreshTrigger =
  | "connect"
  | "manual_provider"
  | "manual_all"
  | "scheduled";

export type DeferredReason = "session_required" | "backoff";

export type FailureCategory =
  | "signed_out"
  | "credential_invalid"
  | "credential_scope_required"
  | "challenge_blocked"
  | "provider_changed"
  | "temporary_error";

export type ProviderRefreshOutcome =
  | { kind: "success"; snapshot: ProviderSnapshot }
  | { kind: "deferred"; reason: DeferredReason; retryAt?: number }
  | {
      kind: "failure";
      category: FailureCategory;
      message?: string;
      retryAt?: number;
    }
  | {
      kind: "skipped";
      reason: "permission_required" | "auto_refresh_disabled" | "superseded";
    };

export const KIMI_RECOVERY_GUIDANCE =
  "Kimi was still starting. Try Refresh once more, or open or reload Kimi.";

export function sanitizedFailureMessage(
  category: FailureCategory,
  requestedMessage?: string,
): string {
  if (
    category === "temporary_error" &&
    requestedMessage === KIMI_RECOVERY_GUIDANCE
  ) {
    return KIMI_RECOVERY_GUIDANCE;
  }

  switch (category) {
    case "signed_out":
      return "Sign in to the provider and try again.";
    case "credential_invalid":
      return "The API key is invalid. Enter a valid key and try again.";
    case "credential_scope_required":
      return "The API key cannot read usage. Update its permissions and try again.";
    case "challenge_blocked":
      return "Open the provider and complete its security check before trying again.";
    case "provider_changed":
      return "AI Limits could not read this provider's usage response.";
    case "temporary_error":
      return "AI Limits could not refresh this provider. Try again later.";
  }
}

export interface RefreshReport {
  trigger: RefreshTrigger;
  startedAt: number;
  finishedAt: number;
  providers: Partial<Record<ProviderId, ProviderRefreshOutcome>>;
}

export interface ProviderAttempt {
  trigger: RefreshTrigger;
  startedAt: number;
  finishedAt: number;
  outcome:
    | { kind: "success" }
    | { kind: "deferred"; reason: DeferredReason; retryAt?: number }
    | {
        kind: "failure";
        category: FailureCategory;
        message?: string;
        retryAt?: number;
      };
}

export type ProviderHealth =
  | { kind: "permission_required" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "signed_out"; message?: string }
  | { kind: "credential_invalid"; message?: string }
  | { kind: "credential_scope_required"; message?: string }
  | { kind: "challenge_blocked"; message?: string }
  | { kind: "provider_changed"; message?: string }
  | { kind: "temporary_error"; message?: string; retryAt?: number };

export interface ProviderRecord {
  providerId: ProviderId;
  access: "required" | "granted";
  history: QuotaHistoryObservation[];
  snapshot?: ProviderSnapshot;
  lastAttempt?: ProviderAttempt;
}

export interface AppState {
  version: 4;
  preferences: {
    displayMode: DisplayMode;
    autoRefresh: boolean;
  };
  providers: ProviderRecord[];
}
