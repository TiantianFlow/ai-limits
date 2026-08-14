import {
  isProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderInstanceRecord,
} from "../domain/instances";
import { isProviderId, type ProviderKind } from "../providers/catalog";

export const PERMISSION_INTENT_SWEEP_ALARM =
  "permission-intent-sweep" as const;
const STORAGE_KEY = "aiLimitsPermissionIntents";
const DEFAULT_TTL_MS = 2 * 60 * 1_000;
const MAX_INTENTS = 16;

export interface PermissionIntentCandidate {
  id: ProviderInstanceId;
  providerKind: ProviderKind;
  config: ProviderInstanceConfig;
  userLabel?: string;
  createdAt: number;
}

export interface StoredPermissionIntent {
  id: string;
  phase: "pending" | "granted";
  candidate: PermissionIntentCandidate;
  expiresAt: number;
}

interface PermissionIntentStoreOptions {
  clock?: () => number;
  randomUUID?: () => string;
  ttlMs?: number;
  storage?: Pick<Browser.storage.StorageArea, "get" | "set">;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function decodeConfig(value: unknown): ProviderInstanceConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "fixed" && hasOnlyKeys(value, ["kind"])) {
    return { kind: "fixed" };
  }
  if (
    value.kind === "dynamic-origin" &&
    hasOnlyKeys(value, ["kind", "baseUrl"]) &&
    typeof value.baseUrl === "string"
  ) {
    return { kind: "dynamic-origin", baseUrl: value.baseUrl };
  }
  return undefined;
}

function decodeCandidate(value: unknown): PermissionIntentCandidate | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["id", "providerKind", "config", "createdAt"],
      ["userLabel"],
    ) ||
    !isProviderInstanceId(value.id) ||
    !isProviderId(value.providerKind) ||
    !value.id.startsWith(`${value.providerKind}:`) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    (Object.hasOwn(value, "userLabel") &&
      (typeof value.userLabel !== "string" || value.userLabel.length > 128))
  ) {
    return undefined;
  }
  const config = decodeConfig(value.config);
  if (!config) return undefined;
  return {
    id: value.id,
    providerKind: value.providerKind,
    config,
    createdAt: value.createdAt,
    ...(typeof value.userLabel === "string"
      ? { userLabel: value.userLabel }
      : {}),
  };
}

function decodeIntent(value: unknown): StoredPermissionIntent | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "phase", "candidate", "expiresAt"]) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    (value.phase !== "pending" && value.phase !== "granted") ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt)
  ) {
    return undefined;
  }
  const candidate = decodeCandidate(value.candidate);
  return candidate
    ? {
        id: value.id,
        phase: value.phase,
        candidate,
        expiresAt: value.expiresAt,
      }
    : undefined;
}

function storedCandidate(
  instance: ProviderInstanceRecord,
): PermissionIntentCandidate {
  return {
    id: instance.id,
    providerKind: instance.providerKind,
    config: instance.config,
    createdAt: instance.createdAt,
    ...(instance.userLabel ? { userLabel: instance.userLabel } : {}),
  };
}

function asPermissionOwner(
  candidate: PermissionIntentCandidate,
): ProviderInstanceRecord {
  return {
    ...candidate,
    access: "required",
    history: [],
  };
}

export function createPermissionIntentStore(
  options: PermissionIntentStoreOptions = {},
) {
  const clock = options.clock ?? Date.now;
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const storage = options.storage ?? browser.storage.session;
  const claimed = new Set<string>();
  let mutationQueue: Promise<void> = Promise.resolve();

  const enqueue = <Result>(mutation: () => Promise<Result>): Promise<Result> => {
    const result = mutationQueue.then(mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const read = async (): Promise<StoredPermissionIntent[]> => {
    const state = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.intents)) {
      return [];
    }
    return state.intents
      .map(decodeIntent)
      .filter((intent): intent is StoredPermissionIntent => intent !== undefined)
      .slice(0, MAX_INTENTS);
  };

  const write = async (intents: readonly StoredPermissionIntent[]) => {
    await storage.set({
      [STORAGE_KEY]: { version: 1, intents: intents.slice(-MAX_INTENTS) },
    });
    const nextExpiry = intents.reduce<number | undefined>(
      (earliest, intent) =>
        earliest === undefined || intent.expiresAt < earliest
          ? intent.expiresAt
          : earliest,
      undefined,
    );
    if (nextExpiry === undefined) {
      await browser.alarms
        .clear(PERMISSION_INTENT_SWEEP_ALARM)
        .catch(() => undefined);
    } else {
      await browser.alarms
        .create(PERMISSION_INTENT_SWEEP_ALARM, { when: nextExpiry })
        .catch(() => undefined);
    }
  };

  return {
    create(instance: ProviderInstanceRecord): Promise<StoredPermissionIntent> {
      return enqueue(async () => {
        const now = clock();
        const active = (await read()).filter(({ expiresAt }) => expiresAt > now);
        if (active.length >= MAX_INTENTS) {
          throw new Error("Too many pending permission intents.");
        }
        const intent: StoredPermissionIntent = {
          id: randomUUID(),
          phase: "pending",
          candidate: storedCandidate(instance),
          expiresAt: now + ttlMs,
        };
        await write([...active, intent]);
        return intent;
      });
    },

    resolveRequest(
      id: string,
      granted: boolean,
    ): Promise<StoredPermissionIntent | undefined> {
      return enqueue(async () => {
        const now = clock();
        const intents = await read();
        const current = intents.find(
          (intent) => intent.id === id && intent.expiresAt > now,
        );
        if (!current) return undefined;
        if (!granted) {
          await write(intents.filter((intent) => intent.id !== id));
          return current;
        }
        const resolved = { ...current, phase: "granted" as const };
        await write(
          intents.map((intent) => (intent.id === id ? resolved : intent)),
        );
        return resolved;
      });
    },

    claim(id: string): Promise<StoredPermissionIntent | undefined> {
      return enqueue(async () => {
        if (claimed.has(id)) return undefined;
        const now = clock();
        const intent = (await read()).find(
          (candidate) =>
            candidate.id === id &&
            candidate.phase === "granted" &&
            candidate.expiresAt > now,
        );
        if (!intent) return undefined;
        claimed.add(id);
        return intent;
      });
    },

    finish(id: string): Promise<void> {
      return enqueue(async () => {
        claimed.delete(id);
        await write((await read()).filter((intent) => intent.id !== id));
      });
    },

    abandon(id: string): Promise<ProviderInstanceRecord | undefined> {
      return enqueue(async () => {
        claimed.delete(id);
        const intents = await read();
        const removed = intents.find((intent) => intent.id === id);
        if (!removed) return undefined;
        await write(intents.filter((intent) => intent.id !== id));
        return asPermissionOwner(removed.candidate);
      });
    },

    listActiveCandidates(): Promise<ProviderInstanceRecord[]> {
      return read().then((intents) =>
        intents
          .filter(({ expiresAt }) => expiresAt > clock())
          .map(({ candidate }) => asPermissionOwner(candidate)),
      );
    },

    sweepExpired(): Promise<ProviderInstanceRecord[]> {
      return enqueue(async () => {
        const now = clock();
        const intents = await read();
        const expired = intents.filter(({ expiresAt }) => expiresAt <= now);
        expired.forEach(({ id }) => claimed.delete(id));
        await write(intents.filter(({ expiresAt }) => expiresAt > now));
        return expired.map(({ candidate }) => asPermissionOwner(candidate));
      });
    },

    clearAll(): Promise<ProviderInstanceRecord[]> {
      return enqueue(async () => {
        const intents = await read();
        claimed.clear();
        await write([]);
        return intents.map(({ candidate }) => asPermissionOwner(candidate));
      });
    },
  };
}
