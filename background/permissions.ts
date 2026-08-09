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

export async function removeAllProviderPermissions(
  providerIds: readonly ConnectableProviderId[],
): Promise<boolean> {
  let granted: Browser.permissions.Permissions;
  try {
    granted = await browser.permissions.getAll();
  } catch {
    return false;
  }

  const grantedOrigins = new Set(granted.origins ?? []);
  const grantedPermissions = new Set(
    (granted.permissions ?? []) as readonly string[],
  );
  const claimedOrigins = new Set<string>();
  const claimedPermissions = new Set<string>();
  const requests = providerIds.map((providerId) => {
    const provider = providerRegistry[providerId];
    const origins = provider.optionalOrigins.filter(
      (origin) => grantedOrigins.has(origin) && !claimedOrigins.has(origin),
    );
    const permissions = (provider.optionalPermissions ?? []).filter(
      (permission) =>
        grantedPermissions.has(permission) &&
        !claimedPermissions.has(permission),
    );
    origins.forEach((origin) => claimedOrigins.add(origin));
    permissions.forEach((permission) => claimedPermissions.add(permission));
    return { origins, permissions };
  });

  const results = await Promise.allSettled(
    requests.map(({ origins, permissions }) => {
      if (origins.length === 0 && permissions.length === 0) {
        return Promise.resolve(true);
      }

      return browser.permissions.remove({
        ...(origins.length > 0 ? { origins } : {}),
        ...(permissions.length > 0 ? { permissions } : {}),
      } as Browser.permissions.Permissions);
    }),
  );

  return results.every(
    (result) => result.status === "fulfilled" && Boolean(result.value),
  );
}
