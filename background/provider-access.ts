import { providerCatalog, type ProviderId } from "../providers/catalog";
import { readProviderCredential } from "../storage/credentials";
import { isProviderConnectionSuppressed } from "../storage/connection-suppressions";
import { hasProviderPermission } from "./permissions";

export async function isProviderConnected(
  providerId: ProviderId,
): Promise<boolean> {
  if (await isProviderConnectionSuppressed(providerId)) {
    return false;
  }
  const credential = await readProviderCredential(providerId);
  if (!(await hasProviderPermission(providerId, { baseUrl: credential?.baseUrl }))) {
    return false;
  }

  if (providerCatalog[providerId].connection.kind === "browser-session") {
    return true;
  }

  return credential !== undefined;
}

export async function isProviderRefreshEligible(
  providerId: ProviderId,
): Promise<boolean> {
  if (await isProviderConnectionSuppressed(providerId)) {
    return false;
  }
  const credential = await readProviderCredential(providerId);
  if (!(await hasProviderPermission(providerId, { baseUrl: credential?.baseUrl }))) {
    return false;
  }

  if (providerCatalog[providerId].connection.kind === "browser-session") {
    return true;
  }

  return credential?.status === "active";
}
