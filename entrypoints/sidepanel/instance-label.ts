import type { ProviderInstanceView } from "../../background/view-state";
import { providerNames } from "../../providers/catalog";

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
