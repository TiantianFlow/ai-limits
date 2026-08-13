import type {
  DeferredReason,
  ProviderHealth,
  ProviderId,
  ProviderRefreshOutcome,
  ProviderSnapshot,
} from "../domain/model";

export interface ProviderCredential {
  kind: "api-key";
  value: string;
}

export interface KimiSessionResolver {
  findAvailableAccessToken(): Promise<string | undefined>;
  recoverAccessToken(rejectedToken?: string): Promise<string | undefined>;
}

export interface CollectionContext {
  fetch: typeof globalThis.fetch;
  now: number;
  signal: AbortSignal;
  credential?: ProviderCredential;
  getCookie?: (details: {
    url: string;
    name: string;
  }) => Promise<{ value: string } | null>;
  interaction?: "allowed" | "forbidden";
  kimiSessionResolver?: KimiSessionResolver;
}

export type CollectionResult =
  | { ok: true; snapshot: ProviderSnapshot }
  | { ok: false; health: ProviderHealth }
  | {
      ok: false;
      deferred: { reason: DeferredReason; retryAt?: number };
    };

export type RefreshCollector<T extends ProviderId = ProviderId> = (
  providerId: T,
) => Promise<ProviderRefreshOutcome>;

export interface ProviderAdapter<T extends ProviderId = ProviderId> {
  readonly id: T;
  collect(context: CollectionContext): Promise<CollectionResult>;
}
