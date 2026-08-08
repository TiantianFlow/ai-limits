export async function findKimiPageAccessToken({
  queryTabs,
  readAccessToken,
}: {
  queryTabs(): Promise<Array<{ id?: number }>>;
  readAccessToken(tabId: number): Promise<unknown>;
}): Promise<string | undefined> {
  for (const tab of await queryTabs()) {
    if (tab.id === undefined) continue;

    try {
      const value = await readAccessToken(tab.id);
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    } catch {
      // An already-open tab may close or navigate while it is inspected.
    }
  }

  return undefined;
}
