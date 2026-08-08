import type {
  ProviderHealth,
  ProviderId,
  ProviderSnapshot,
} from "../domain/model";

export interface CollectionContext {
  fetch: typeof globalThis.fetch;
  now: number;
  signal: AbortSignal;
  getCookie?: (details: {
    url: string;
    name: string;
  }) => Promise<{ value: string } | null>;
  getAccessToken?: () => Promise<string | undefined>;
  getRefreshedAccessToken?: (
    staleAccessToken: string,
  ) => Promise<string | undefined>;
}

export type CollectionResult =
  | { ok: true; snapshot: ProviderSnapshot }
  | { ok: false; health: ProviderHealth };

export interface ProviderCapabilities {
  readonly browserSession: boolean;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  readonly optionalOrigins: readonly string[];
  readonly optionalPermissions?: readonly string[];
  collect(context: CollectionContext): Promise<CollectionResult>;
}
