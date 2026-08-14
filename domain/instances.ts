import type {
  DisplayMode,
  ProviderAttempt,
  UsageHistoryObservation,
  UsageSnapshot,
} from "./model";
import { isProviderId, type ProviderKind } from "../providers/catalog";

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

export function isConnectionRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export interface InstanceAppState {
  version: 5;
  preferences: {
    displayMode: DisplayMode;
    autoRefresh: boolean;
  };
  instances: ProviderInstanceRecord[];
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
  return isProviderId(providerKind) &&
    (suffix === "default" || UUID_SUFFIX.test(suffix));
}
