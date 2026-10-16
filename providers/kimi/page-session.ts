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
  appMounted?: boolean,
): string | undefined {
  if (currentOrigin !== expectedOrigin) {
    return undefined;
  }

  // The homepage SSR shell already contains the chat UI. Kimi sets this flag
  // only after the client router is ready and app.mount("#app") runs, which is
  // the earliest point its own session refresh can replace access_token.
  const mounted =
    appMounted ??
    ((globalThis as { __kimiAppMounted?: unknown }).__kimiAppMounted === true);
  if (!mounted) return undefined;

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
