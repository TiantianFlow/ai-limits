import type { ProviderInstanceView } from "../../domain/public-protocol";
import { providerNames } from "../../providers/catalog";
import type { ProviderInstanceId } from "../../domain/instances";

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
  return new Map(
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
}
