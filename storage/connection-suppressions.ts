import {
  isProviderId,
  providerIds as providerIdsFromCatalog,
  type ProviderId,
} from "../providers/catalog";

const CONNECTION_SUPPRESSIONS_KEY = "aiLimitsConnectionSuppressions";
let suppressionMutationQueue: Promise<void> = Promise.resolve();
let suppressionIntentGeneration = 0;

interface SuppressionIntent {
  generation: number;
  suppressed: boolean;
}

const pendingSuppressionIntents = new Map<ProviderId, SuppressionIntent>();

function beginSuppressionIntents(
  entries: readonly (readonly [ProviderId, boolean])[],
): SuppressionIntent[] {
  return entries.map(([providerId, suppressed]) => {
    const intent = {
      generation: ++suppressionIntentGeneration,
      suppressed,
    };
    pendingSuppressionIntents.set(providerId, intent);
    return intent;
  });
}

function finishSuppressionIntents(
  entries: readonly (readonly [ProviderId, boolean])[],
  intents: readonly SuppressionIntent[],
): void {
  entries.forEach(([providerId], index) => {
    if (
      pendingSuppressionIntents.get(providerId)?.generation ===
      intents[index]?.generation
    ) {
      pendingSuppressionIntents.delete(providerId);
    }
  });
}

function enqueueWithSuppressionIntents(
  entries: readonly (readonly [ProviderId, boolean])[],
  mutation: () => Promise<void>,
): Promise<void> {
  const intents = beginSuppressionIntents(entries);
  return enqueueSuppressionMutation(mutation).then(
    () => finishSuppressionIntents(entries, intents),
    (error) => {
      finishSuppressionIntents(entries, intents);
      throw error;
    },
  );
}

function enqueueSuppressionMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = suppressionMutationQueue.then(mutation);
  suppressionMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readSuppressions(): Promise<Set<ProviderId>> {
  const stored = await browser.storage.local.get(CONNECTION_SUPPRESSIONS_KEY);
  const value = stored[CONNECTION_SUPPRESSIONS_KEY];
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter(isProviderId));
}

async function writeSuppressions(
  suppressions: ReadonlySet<ProviderId>,
): Promise<void> {
  if (suppressions.size === 0) {
    await browser.storage.local.remove(CONNECTION_SUPPRESSIONS_KEY);
    return;
  }
  await browser.storage.local.set({
    [CONNECTION_SUPPRESSIONS_KEY]: [...suppressions],
  });
}

export async function isProviderConnectionSuppressed(
  providerId: ProviderId,
): Promise<boolean> {
  const pendingBeforeRead = pendingSuppressionIntents.get(providerId);
  if (pendingBeforeRead) return pendingBeforeRead.suppressed;

  const persisted = (await readSuppressions()).has(providerId);
  return pendingSuppressionIntents.get(providerId)?.suppressed ?? persisted;
}

export function setProviderConnectionSuppressed(
  providerId: ProviderId,
  suppressed: boolean,
): Promise<void> {
  const entries = [[providerId, suppressed]] as const;
  return enqueueWithSuppressionIntents(entries, async () => {
    const suppressions = await readSuppressions();
    if (suppressed) {
      suppressions.add(providerId);
    } else {
      suppressions.delete(providerId);
    }
    await writeSuppressions(suppressions);
  });
}

export function replaceProviderConnectionSuppressions(
  providerIds: readonly ProviderId[],
): Promise<void> {
  const replacement = new Set(providerIds);
  const entries = providerIdsFromCatalog.map(
    (providerId) => [providerId, replacement.has(providerId)] as const,
  );
  return enqueueWithSuppressionIntents(entries, () =>
    writeSuppressions(replacement),
  );
}

export function clearProviderConnectionSuppressions(
  providerIds: readonly ProviderId[],
): Promise<void> {
  const entries = providerIds.map(
    (providerId) => [providerId, false] as const,
  );
  return enqueueWithSuppressionIntents(entries, async () => {
    const suppressions = await readSuppressions();
    providerIds.forEach((providerId) => suppressions.delete(providerId));
    await writeSuppressions(suppressions);
  });
}
