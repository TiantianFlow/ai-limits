const KIMI_ORIGIN = "https://www.kimi.com";

interface StorageReader {
  getItem(key: string): string | null;
}

interface ScriptResult {
  result?: unknown;
}

interface ExecuteScript {
  (details: {
    target: { tabId: number };
    world: "MAIN";
    func: typeof readKimiAccessTokenAtExpectedOrigin;
    args: [string];
  }): Promise<ScriptResult[]>;
}

export function readKimiAccessTokenAtExpectedOrigin(
  expectedOrigin: string,
  storage: StorageReader = globalThis.localStorage,
  currentOrigin: string = globalThis.location.origin,
): string | undefined {
  if (currentOrigin !== expectedOrigin) {
    return undefined;
  }

  return storage.getItem("access_token") ?? undefined;
}

export async function readKimiPageAccessToken(
  tabId: number,
  executeScript: ExecuteScript,
): Promise<unknown> {
  const [injection] = await executeScript({
    target: { tabId },
    world: "MAIN",
    func: readKimiAccessTokenAtExpectedOrigin,
    args: [KIMI_ORIGIN],
  });
  return injection?.result;
}
