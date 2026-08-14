import type {
  DeferredReason,
  FailureGuidance,
  ProviderHealth,
  UsageSnapshot,
} from "../domain/model";
import type {
  ProviderInstanceConfig,
  ProviderInstanceRecord,
} from "../domain/model";
import type { ProviderKind } from "../domain/provider-kind";

export interface ProviderCredential {
  kind: "api-key";
  value: string;
}

export interface CollectionContext {
  fetch: typeof globalThis.fetch;
  now: number;
  signal: AbortSignal;
  credential?: ProviderCredential;
  baseUrl?: string;
  accessToken?: string;
}

export type CollectionResult =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; health: ProviderHealth }
  | {
      ok: false;
      deferred: { reason: DeferredReason; retryAt?: number };
    };

export interface ProviderCollector<T extends ProviderKind = ProviderKind> {
  readonly id: T;
  collect(context: CollectionContext): Promise<CollectionResult>;
}

export interface ProviderRuntimeServices {
  fetch: typeof globalThis.fetch;
  now: number;
  signal: AbortSignal;
  interaction: "allowed" | "forbidden";
}

export interface ProviderPackage {
  readonly kind: ProviderKind;
  readonly cardinality: "single" | "multiple";
  readonly credentialKind: "none" | "api-key";
  readonly configKind: ProviderInstanceConfig["kind"];
  readonly failureGuidance?: Partial<Record<FailureGuidance, string>>;
  normalizeConfig(value: unknown): ProviderInstanceConfig | undefined;
  requiredPermissions(
    config: ProviderInstanceConfig,
  ): Browser.permissions.Permissions | undefined;
  collect(
    instance: ProviderInstanceRecord,
    services: ProviderRuntimeServices,
    credentialOverride?: ProviderCredential,
  ): Promise<CollectionResult>;
  startup?(): Promise<void>;
}
