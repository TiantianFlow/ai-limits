import type { ProviderInstanceRecord } from "../domain/model";
import type { ProviderKind } from "../providers/catalog";
import { providerRegistry } from "../providers/registry";
import type { ProviderPackage } from "../providers/types";

export type PermissionPackageCatalog = {
  [Kind in ProviderKind]: Pick<ProviderPackage, "requiredPermissions">;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function compactPermissions(
  origins: readonly string[],
  permissions: readonly string[],
): Browser.permissions.Permissions | undefined {
  const uniqueOrigins = unique(origins);
  const uniquePermissions = unique(permissions);
  if (uniqueOrigins.length === 0 && uniquePermissions.length === 0) {
    return undefined;
  }
  return {
    ...(uniqueOrigins.length ? { origins: uniqueOrigins } : {}),
    ...(uniquePermissions.length ? { permissions: uniquePermissions } : {}),
  } as Browser.permissions.Permissions;
}

export function requiredPermissionsForInstance(
  instance: ProviderInstanceRecord,
  packages: PermissionPackageCatalog = providerRegistry,
): Browser.permissions.Permissions | undefined {
  return packages[instance.providerKind].requiredPermissions(instance.config);
}

export async function hasInstancePermission(
  instance: ProviderInstanceRecord,
  packages: PermissionPackageCatalog = providerRegistry,
): Promise<boolean> {
  const required = requiredPermissionsForInstance(instance, packages);
  return required ? Boolean(await browser.permissions.contains(required)) : true;
}

export async function requestInstancePermission(
  instance: ProviderInstanceRecord,
  packages: PermissionPackageCatalog = providerRegistry,
): Promise<boolean> {
  const required = requiredPermissionsForInstance(instance, packages);
  return required ? Boolean(await browser.permissions.request(required)) : true;
}

export function permissionChangeAffectsInstance(
  instance: ProviderInstanceRecord,
  changed: Browser.permissions.Permissions | undefined,
  packages: PermissionPackageCatalog = providerRegistry,
): boolean {
  const required = requiredPermissionsForInstance(instance, packages);
  if (!required || !changed) return false;
  const changedOrigins = new Set(changed.origins ?? []);
  const changedPermissions = new Set(
    (changed.permissions ?? []) as readonly string[],
  );
  return (
    (required.origins ?? []).some((origin) => changedOrigins.has(origin)) ||
    ((required.permissions ?? []) as readonly string[]).some((permission) =>
      changedPermissions.has(permission),
    )
  );
}

function permissionUnion(
  instances: readonly ProviderInstanceRecord[],
  packages: PermissionPackageCatalog,
): Browser.permissions.Permissions | undefined {
  const origins: string[] = [];
  const permissions: string[] = [];
  for (const instance of instances) {
    const required = requiredPermissionsForInstance(instance, packages);
    origins.push(...(required?.origins ?? []));
    permissions.push(
      ...((required?.permissions ?? []) as readonly string[]),
    );
  }
  return compactPermissions(origins, permissions);
}

async function exactPermissionsAreAbsent(
  permissions: Browser.permissions.Permissions,
): Promise<boolean> {
  try {
    const checks = [
      ...(permissions.origins ?? []).map((origin) =>
        browser.permissions.contains({ origins: [origin] }),
      ),
      ...((permissions.permissions ?? []) as readonly string[]).map((permission) =>
        browser.permissions.contains({
          permissions: [permission as Browser.runtime.ManifestPermission],
        }),
      ),
    ];
    const present = await Promise.all(checks);
    return present.every((value) => !value);
  } catch {
    return false;
  }
}

export async function removeUnusedInstancePermissions(
  removedInstance: ProviderInstanceRecord,
  remainingInstances: readonly ProviderInstanceRecord[],
  packages: PermissionPackageCatalog = providerRegistry,
): Promise<boolean> {
  const removed = requiredPermissionsForInstance(removedInstance, packages);
  if (!removed) return true;
  const remaining = permissionUnion(remainingInstances, packages);
  const remainingOrigins = new Set(remaining?.origins ?? []);
  const remainingPermissions = new Set(
    (remaining?.permissions ?? []) as readonly string[],
  );
  const removable = compactPermissions(
    (removed.origins ?? []).filter((origin) => !remainingOrigins.has(origin)),
    ((removed.permissions ?? []) as readonly string[]).filter(
      (permission) => !remainingPermissions.has(permission),
    ),
  );
  if (!removable) return true;
  try {
    await browser.permissions.remove(removable);
  } catch {
    // The exact postcondition below is authoritative.
  }
  return exactPermissionsAreAbsent(removable);
}

export async function removeAllInstancePermissions(
  instances: readonly ProviderInstanceRecord[],
  packages: PermissionPackageCatalog = providerRegistry,
): Promise<boolean> {
  const removable = permissionUnion(instances, packages);
  if (!removable) return true;
  try {
    await browser.permissions.remove(removable);
  } catch {
    // The exact postcondition below is authoritative.
  }
  return exactPermissionsAreAbsent(removable);
}
