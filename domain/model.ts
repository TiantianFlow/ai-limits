export type ProviderId =
  | "chatgpt"
  | "claude"
  | "kimi"
  | "cursor"
  | "antigravity";

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

export type ProviderHealth =
  | { kind: "permission_required" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "signed_out"; message?: string }
  | { kind: "challenge_blocked"; message?: string }
  | { kind: "provider_changed"; message?: string }
  | { kind: "temporary_error"; message?: string; retryAt?: number }
  | { kind: "experimental_unavailable"; message?: string };

export interface ProviderRecord {
  providerId: ProviderId;
  snapshot?: ProviderSnapshot;
  health: ProviderHealth;
}

export interface AppState {
  demoMode: boolean;
  preferences: {
    displayMode: DisplayMode;
  };
  providers: ProviderRecord[];
}
