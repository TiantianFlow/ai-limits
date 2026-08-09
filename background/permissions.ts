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

export async function removeProviderPermission(
  providerId: ConnectableProviderId,
  remainingConnectedProviderIds: readonly ConnectableProviderId[],
): Promise<boolean> {
  const remainingOrigins = new Set(
    remainingConnectedProviderIds.flatMap((remainingProviderId) =>
      providerRegistry[remainingProviderId].optionalOrigins,
    ),
  );
  const remainingPermissions = new Set(
    remainingConnectedProviderIds.flatMap(
      (remainingProviderId) =>
        providerRegistry[remainingProviderId].optionalPermissions ?? [],
    ),
  );
  const provider = providerRegistry[providerId];
  const origins = provider.optionalOrigins.filter(
    (origin) => !remainingOrigins.has(origin),
  );
  const permissions = (provider.optionalPermissions ?? []).filter(
    (permission) => !remainingPermissions.has(permission),
  );

  if (origins.length === 0 && permissions.length === 0) {
    return true;
  }

  return browser.permissions.remove({
    ...(origins.length > 0 ? { origins: [...origins] } : {}),
    ...(permissions.length > 0 ? { permissions: [...permissions] } : {}),
  } as Browser.permissions.Permissions);
}
