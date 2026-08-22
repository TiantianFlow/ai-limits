import {
  isProviderKind,
  type ProviderKind,
} from "./provider-kind";

export type { ProviderKind } from "./provider-kind";

export type DisplayMode = "used" | "left";

export type ProviderInstanceId = string;

export type ProviderInstanceConfig =
  | { kind: "fixed" }
  | { kind: "dynamic-origin"; baseUrl: string };

export interface ProviderInstanceRecord {
  id: ProviderInstanceId;
  providerKind: ProviderKind;
  userLabel?: string;
  config: ProviderInstanceConfig;
  connectionRevision?: string;
  access: "required" | "granted";
  createdAt: number;
  history: UsageHistoryObservation[];
  snapshot?: UsageSnapshot;
  lastAttempt?: ProviderAttempt;
}

export interface InstanceAppState {
  version: 5;
  preferences: {
    displayMode: DisplayMode;
    autoRefresh: boolean;
  };
  instances: ProviderInstanceRecord[];
}

export function isConnectionRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

const UUID_SUFFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProviderInstanceId(
  value: unknown,
): value is ProviderInstanceId {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\\/]/.test(value)
  ) {
    return false;
  }

  const separator = value.indexOf(":");
  if (separator <= 0 || value.indexOf(":", separator + 1) !== -1) {
    return false;
  }
  const providerKind = value.slice(0, separator);
  const suffix = value.slice(separator + 1);
  return (
    isProviderKind(providerKind) &&
    (suffix === "default" || UUID_SUFFIX.test(suffix))
  );
}

export interface UsageGroup {
  id: string;
  label: string;
  description?: string;
  metricIds: string[];
}

export type MetricScope = "general" | "model" | "feature" | "product";

export interface MetricCycle {
  cadence?: "rolling" | "calendar";
  startedAt?: number;
  resetsAt?: number;
  durationMs?: number;
}

export interface MetricSegment {
  id: string;
  label: string;
  usedRatio: number;
}

interface MetricBase {
  id: string;
  label: string;
  scope: MetricScope;
  cycle?: MetricCycle;
  /** Original collection time. Older than snapshot.fetchedAt means carried. */
  observedAt?: number;
}

export interface QuotaMetric extends MetricBase {
  type: "quota";
  usedRatio: number;
  used?: number;
  limit?: number;
  unit?: string;
  segments?: MetricSegment[];
}

export interface CounterMetric extends MetricBase {
  type: "counter";
  semantic: "consumed" | "spent";
  value: number;
  unit: string;
  limit?: number;
}

export interface BalanceMetric extends MetricBase {
  type: "balance";
  value: number;
  unit: string;
  initialLimit?: number;
}

export type UsageMetric = QuotaMetric | CounterMetric | BalanceMetric;

export interface UsageSnapshot {
  providerKind: ProviderKind;
  accountLabel?: string;
  planLabel?: string;
  source: "web-session" | "oauth" | "api-key" | "fixture";
  fetchedAt: number;
  metrics: UsageMetric[];
  usageGroups?: UsageGroup[];
}

export type MetricHistorySample =
  | ({ metricId: string } & Pick<QuotaMetric, "type" | "usedRatio" | "cycle">)
  | ({ metricId: string } & Pick<CounterMetric, "type" | "semantic" | "value" | "unit" | "limit" | "cycle">)
  | ({ metricId: string } & Pick<BalanceMetric, "type" | "value" | "unit" | "initialLimit" | "cycle">);

export interface UsageHistoryObservation {
  observedAt: number;
  metrics: MetricHistorySample[];
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

export type FailureGuidance = "retry_session";

export function sanitizedFailureGuidance(
  value: unknown,
): FailureGuidance | undefined {
  return value === "retry_session" ? value : undefined;
}

export type ProviderRefreshOutcome =
  | { kind: "success"; snapshot: UsageSnapshot }
  | { kind: "deferred"; reason: DeferredReason; retryAt?: number }
  | {
      kind: "failure";
      category: FailureCategory;
      message?: string;
      guidance?: FailureGuidance;
      retryAt?: number;
    }
  | {
      kind: "skipped";
      reason: "permission_required" | "auto_refresh_disabled" | "superseded";
    };

export function sanitizedFailureMessage(
  category: FailureCategory,
  _requestedMessage?: string,
): string {
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
  results: InstanceRefreshResult[];
}

export interface InstanceRefreshResult {
  instanceId: ProviderInstanceId;
  outcome: ProviderRefreshOutcome;
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
        guidance?: FailureGuidance;
        retryAt?: number;
      };
}

export type ProviderHealth =
  | { kind: "permission_required" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "signed_out"; message?: string; guidance?: FailureGuidance }
  | { kind: "credential_invalid"; message?: string; guidance?: FailureGuidance }
  | { kind: "credential_scope_required"; message?: string; guidance?: FailureGuidance }
  | { kind: "challenge_blocked"; message?: string; guidance?: FailureGuidance }
  | { kind: "provider_changed"; message?: string; guidance?: FailureGuidance }
  | { kind: "temporary_error"; message?: string; guidance?: FailureGuidance; retryAt?: number };
