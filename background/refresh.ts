export async function refreshGrantedProviders<T extends string>(
  providerIds: readonly T[],
  hasPermission: (providerId: T) => Promise<boolean>,
  collect: (providerId: T) => Promise<void>,
): Promise<void> {
  const granted = await Promise.all(
    providerIds.map(async (providerId) =>
      (await hasPermission(providerId)) ? providerId : undefined,
    ),
  );

  await Promise.allSettled(
    granted.flatMap((providerId) =>
      providerId === undefined ? [] : [collect(providerId)],
    ),
  );
}
