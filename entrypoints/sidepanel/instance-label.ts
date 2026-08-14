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

function shortUniqueId(
  instance: ProviderInstanceView,
  collisions: readonly ProviderInstanceView[],
): string {
  const identity = instance.id.slice(instance.id.indexOf(":") + 1);
  for (let length = Math.min(8, identity.length); length < identity.length; length += 1) {
    const candidate = identity.slice(0, length);
    if (
      collisions.every(
        (other) =>
          other.id === instance.id ||
          other.id.slice(other.id.indexOf(":") + 1, other.id.indexOf(":") + 1 + length) !==
            candidate,
      )
    ) {
      return candidate;
    }
  }
  return identity;
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
        siblings.length > 1 && !nonBlank(instance.userLabel)
          ? `${label} · ${shortUniqueId(instance, siblings)}`
          : label,
      ] as const;
    }),
  );
}
