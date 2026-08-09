export type ProviderId =
  | "chatgpt"
  | "claude"
  | "kimi"
  | "cursor";

export type DisplayMode = "used" | "left";

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

export interface ProviderSnapshot {
  providerId: ProviderId;
  accountLabel?: string;
  planLabel?: string;
  source: "web-session" | "oauth" | "fixture";
  fetchedAt: number;
  windows: QuotaWindow[];
  credits: CreditBalance[];
}

export type RefreshTrigger =
  | "connect"
  | "manual_provider"
  | "manual_all"
  | "scheduled";

export type DeferredReason = "session_required" | "backoff";

export type FailureCategory =
  | "signed_out"
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
      reason: "permission_required" | "auto_refresh_disabled";
    };

export interface RefreshReport {
  trigger: RefreshTrigger;
  startedAt: number;
  finishedAt: number;
  providers: Partial<Record<ProviderId, ProviderRefreshOutcome>>;
}

export type ProviderHealth =
  | { kind: "permission_required" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "signed_out"; message?: string }
  | { kind: "challenge_blocked"; message?: string }
  | { kind: "provider_changed"; message?: string }
  | { kind: "temporary_error"; message?: string; retryAt?: number };

export interface ProviderRecord {
  providerId: ProviderId;
  snapshot?: ProviderSnapshot;
  health: ProviderHealth;
}

export interface AppState {
  version: 2;
  preferences: {
    displayMode: DisplayMode;
  };
  providers: ProviderRecord[];
}
