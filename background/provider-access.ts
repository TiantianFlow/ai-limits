import type { ProviderInstanceRecord } from "../domain/instances";
import { providerRegistry } from "../providers/registry";
import type { ProviderPackage } from "../providers/types";
import { readCredentialWithRevision } from "../storage/credential-vault";
import { hasInstancePermission } from "./permissions";

type ProviderPackageCatalog = Record<
  ProviderInstanceRecord["providerKind"],
  ProviderPackage
>;

export async function isProviderConnected(
  instance: ProviderInstanceRecord,
  packages: ProviderPackageCatalog = providerRegistry,
): Promise<boolean> {
  const providerPackage = packages[instance.providerKind];
  if (!(await hasInstancePermission(instance, packages))) return false;
  if (providerPackage.credentialKind === "none") return true;
  const credential = await readCredentialWithRevision(instance.id);
  return Boolean(
    credential && instance.connectionRevision === credential.revision,
  );
}

export async function isProviderRefreshEligible(
  instance: ProviderInstanceRecord,
  packages: ProviderPackageCatalog = providerRegistry,
): Promise<boolean> {
  const providerPackage = packages[instance.providerKind];
  if (!(await hasInstancePermission(instance, packages))) return false;
  if (providerPackage.credentialKind === "none") return true;
  const credential = await readCredentialWithRevision(instance.id);
  return (
    credential?.status === "active" &&
    instance.connectionRevision === credential.revision
  );
}
