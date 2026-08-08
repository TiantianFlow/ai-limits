import {
  providerRegistry,
  type ConnectableProviderId,
} from "../providers/registry";

function permissionsFor(providerId: ConnectableProviderId): Browser.permissions.Permissions {
  const provider = providerRegistry[providerId];
  return {
    origins: [...provider.optionalOrigins],
    ...(provider.optionalPermissions
      ? { permissions: [...provider.optionalPermissions] }
      : {}),
  } as Browser.permissions.Permissions;
}

export async function hasProviderPermission(
  providerId: ConnectableProviderId,
): Promise<boolean> {
  return Boolean(await browser.permissions.contains(permissionsFor(providerId)));
}

export async function requestProviderPermission(
  providerId: ConnectableProviderId,
): Promise<boolean> {
  return browser.permissions.request(permissionsFor(providerId));
}
