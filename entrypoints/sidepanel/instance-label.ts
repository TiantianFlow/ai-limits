import type { ProviderInstanceView } from "../../domain/public-protocol";
import { providerNames } from "../../providers/catalog";
import type { ProviderInstanceId } from "../../domain/model";

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function dynamicOriginHostname(
  instance: Pick<ProviderInstanceView, "origin">,
): string | undefined {
  if (!instance.origin) return undefined;
  try {
    return nonBlank(new URL(instance.origin).hostname);
  } catch {
    return undefined;
  }
}

export function instanceLabel(instance: ProviderInstanceView): string {
  return (
    nonBlank(instance.userLabel) ??
    nonBlank(instance.snapshot?.accountLabel) ??
    dynamicOriginHostname(instance) ??
    providerNames[instance.providerKind]
  );
}

function idTail(instance: ProviderInstanceView): string {
  return instance.id.slice(instance.id.indexOf(":") + 1);
}

function uniqueCandidate(
  instance: ProviderInstanceView,
  collisions: readonly ProviderInstanceView[],
  candidateFor: (candidate: ProviderInstanceView) => string,
): string | undefined {
  const candidate = candidateFor(instance);
  return collisions.every(
    (other) => other.id === instance.id || candidateFor(other) !== candidate,
  )
    ? candidate
    : undefined;
}

function stableUniqueSuffix(
  instance: ProviderInstanceView,
  collisions: readonly ProviderInstanceView[],
): string {
  const preferred = uniqueCandidate(instance, collisions, (candidate) => {
    const identity = idTail(candidate);
    return identity === "default" ? identity : identity.slice(0, 8);
  });
  if (preferred) return preferred;

  const provider = uniqueCandidate(
    instance,
    collisions,
    (candidate) => providerNames[candidate.providerKind],
  );
  if (provider) return provider;

  const maximumLength = Math.max(...collisions.map((candidate) => idTail(candidate).length));
  for (let length = 9; length <= maximumLength; length += 1) {
    const extended = uniqueCandidate(instance, collisions, (candidate) =>
      idTail(candidate).slice(0, length),
    );
    if (extended) return extended;
  }

  return instance.id;
}

export function instanceLabels(
  instances: readonly ProviderInstanceView[],
): ReadonlyMap<ProviderInstanceId, string> {
  const baseLabels = new Map(
    instances.map((instance) => [instance.id, instanceLabel(instance)] as const),
  );
  const collisions = new Map<string, ProviderInstanceView[]>();
  for (const instance of instances) {
    const label = baseLabels.get(instance.id)!;
    collisions.set(label, [...(collisions.get(label) ?? []), instance]);
  }
  const initialLabels = new Map(
    instances.map((instance) => {
      const label = baseLabels.get(instance.id)!;
      const siblings = collisions.get(label) ?? [];
      return [
        instance.id,
        siblings.length > 1
          ? `${label} · ${stableUniqueSuffix(instance, siblings)}`
          : label,
      ] as const;
    }),
  );
  const reservedLiteralLabels = new Set(
    instances.flatMap((instance) => {
      const baseLabel = baseLabels.get(instance.id)!;
      return collisions.get(baseLabel)?.length === 1 ? [baseLabel] : [];
    }),
  );
  const usedLabels = new Set<string>();
  const resolvedLabels = new Map<ProviderInstanceId, string>();
  const sortedInstances = [...instances].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  for (const instance of sortedInstances) {
    const baseLabel = baseLabels.get(instance.id)!;
    const generated = (collisions.get(baseLabel)?.length ?? 0) > 1;
    let label = initialLabels.get(instance.id)!;
    const unavailable = (candidate: string) =>
      usedLabels.has(candidate) ||
      (generated && reservedLiteralLabels.has(candidate));
    if (unavailable(label)) {
      const fullIdentityLabel = `${label} · ${instance.id}`;
      label = fullIdentityLabel;
      for (let counter = 2; unavailable(label); counter += 1) {
        label = `${fullIdentityLabel} · ${counter}`;
      }
    }
    usedLabels.add(label);
    resolvedLabels.set(instance.id, label);
  }
  return new Map(
    instances.map((instance) => [instance.id, resolvedLabels.get(instance.id)!]),
  );
}
