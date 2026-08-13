import { providerCatalog } from "../providers/catalog";
import { newApiPermissionOrigin } from "../providers/newapi/url";
import type { ConnectableProviderId } from "../providers/registry";

interface PermissionDefinition {
  readonly optionalOrigins: readonly string[];
  readonly optionalPermissions: readonly string[];
  readonly connection?:
    | { readonly kind: "browser-session" }
    | { readonly kind: "api-key"; readonly origin: "static" | "dynamic" };
}

type PermissionCatalog = Record<ConnectableProviderId, PermissionDefinition>;

export interface ProviderPermissionContext {
  readonly baseUrl?: string;
}

function isSupportedNewApiGrantedOrigin(origin: string): boolean {
  if (!origin.endsWith("/*")) return false;
  const rawOrigin = origin.slice(0, -2);
  try {
    const parsed = new URL(rawOrigin);
    return (
      origin === `${parsed.origin}/*` &&
      (parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")))
    );
  } catch {
    return false;
  }
}

function isStaticProviderOrigin(
  origin: string,
  catalog: PermissionCatalog,
): boolean {
  return Object.values(catalog).some(
    (provider) =>
      !(
        provider.connection?.kind === "api-key" &&
        provider.connection.origin === "dynamic"
      ) && provider.optionalOrigins.includes(origin),
  );
}

function permissionsFor(
  providerId: ConnectableProviderId,
  catalog: PermissionCatalog = providerCatalog,
  context: ProviderPermissionContext = {},
): Browser.permissions.Permissions | undefined {
  const provider = catalog[providerId];
  const origins =
    provider.connection?.kind === "api-key" &&
    provider.connection.origin === "dynamic"
      ? [newApiPermissionOrigin(context.baseUrl)].filter(
          (origin): origin is string => origin !== undefined,
        )
      : [...provider.optionalOrigins];
  if (
    provider.connection?.kind === "api-key" &&
    provider.connection.origin === "dynamic" &&
    origins.length === 0
  ) {
    return undefined;
  }
  return {
    origins,
    ...(provider.optionalPermissions.length > 0
      ? { permissions: [...provider.optionalPermissions] }
      : {}),
  } as Browser.permissions.Permissions;
}

export async function hasProviderPermission(
  providerId: ConnectableProviderId,
  context: ProviderPermissionContext = {},
): Promise<boolean> {
  const permissions = permissionsFor(providerId, providerCatalog, context);
  return permissions
    ? Boolean(await browser.permissions.contains(permissions))
    : false;
}

export async function requestProviderPermission(
  providerId: ConnectableProviderId,
  context: ProviderPermissionContext = {},
): Promise<boolean> {
  const permissions = permissionsFor(providerId, providerCatalog, context);
  return permissions ? browser.permissions.request(permissions) : false;
}

export function permissionChangeAffectsProvider(
  providerId: ConnectableProviderId,
  changed: Browser.permissions.Permissions | undefined,
  catalog: PermissionCatalog = providerCatalog,
): boolean {
  const provider = catalog[providerId];
  const dynamic =
    provider.connection?.kind === "api-key" &&
    provider.connection.origin === "dynamic";
  return (
    provider.optionalPermissions.some((permission) =>
      (changed?.permissions as readonly string[] | undefined)?.includes(permission),
    ) ||
    (changed?.origins ?? []).some((origin) =>
      dynamic
        ? isSupportedNewApiGrantedOrigin(origin) &&
          !isStaticProviderOrigin(origin, catalog)
        : provider.optionalOrigins.includes(origin),
    )
  );
}

export async function removeProviderPermission(
  providerId: ConnectableProviderId,
  remainingConnectedProviderIds: readonly ConnectableProviderId[],
  catalog: PermissionCatalog = providerCatalog,
  context: ProviderPermissionContext = {},
): Promise<boolean> {
  const remainingOrigins = new Set(
    remainingConnectedProviderIds.flatMap((remainingProviderId) =>
      catalog[remainingProviderId].optionalOrigins,
    ),
  );
  const remainingPermissions = new Set(
    remainingConnectedProviderIds.flatMap(
      (remainingProviderId) =>
        catalog[remainingProviderId].optionalPermissions,
    ),
  );
  const provider = catalog[providerId];
  const requestedOrigins =
    provider.connection?.kind === "api-key" &&
    provider.connection.origin === "dynamic"
      ? [newApiPermissionOrigin(context.baseUrl)].filter(
          (origin): origin is string => origin !== undefined,
        )
      : provider.optionalOrigins;
  if (
    provider.connection?.kind === "api-key" &&
    provider.connection.origin === "dynamic" &&
    requestedOrigins.length === 0
  ) {
    return false;
  }
  const origins = requestedOrigins.filter(
    (origin) => !remainingOrigins.has(origin),
  );
  const permissions = provider.optionalPermissions.filter(
    (permission) => !remainingPermissions.has(permission),
  );

  if (origins.length === 0 && permissions.length === 0) {
    return true;
  }

  const removablePermissions = {
    ...(origins.length > 0 ? { origins: [...origins] } : {}),
    ...(permissions.length > 0 ? { permissions: [...permissions] } : {}),
  } as Browser.permissions.Permissions;
  try {
    await browser.permissions.remove(removablePermissions);
  } catch {
    // The exact permission postcondition below is authoritative.
  }
  return !(await browser.permissions.contains(removablePermissions));
}

export async function removeAllProviderPermissions(
  providerIds: readonly ConnectableProviderId[],
  catalog: PermissionCatalog = providerCatalog,
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
    const provider = catalog[providerId];
    const dynamic =
      provider.connection?.kind === "api-key" &&
      provider.connection.origin === "dynamic";
    const origins = dynamic
      ? [...grantedOrigins].filter(
          (origin) =>
            isSupportedNewApiGrantedOrigin(origin) && !claimedOrigins.has(origin),
        )
      : provider.optionalOrigins.filter(
          (origin) => grantedOrigins.has(origin) && !claimedOrigins.has(origin),
        );
    const permissions = provider.optionalPermissions.filter(
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
