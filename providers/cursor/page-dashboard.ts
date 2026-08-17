export interface CursorDashboardJson {
  readonly grok?: unknown;
  readonly credits?: unknown;
}

interface CursorTab {
  id?: number;
}

interface CursorScriptResult {
  result?: unknown;
}

interface CursorDashboardBridge {
  queryTabs(details: { url: string }): Promise<CursorTab[]>;
  executeScript(details: {
    target: { tabId: number };
    world: "MAIN";
    func: typeof readCursorDashboardJsonAtExpectedOrigin;
  }): Promise<CursorScriptResult[]>;
}

export async function readCursorDashboardJsonAtExpectedOrigin(
  fetchPage: typeof globalThis.fetch = globalThis.fetch,
  currentOrigin: string = globalThis.location.origin,
): Promise<CursorDashboardJson | undefined> {
  if (currentOrigin !== "https://cursor.com") return undefined;

  const readJson = async (url: string): Promise<unknown> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await fetchPage(url, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: abortController.signal,
      });
      return response.ok ? await response.json() : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const [grok, credits] = await Promise.all([
    readJson("https://cursor.com/api/dashboard/get-sand-usage-status"),
    readJson("https://cursor.com/api/dashboard/get-credit-grants-balance"),
  ]);
  return {
    ...(grok === undefined ? {} : { grok }),
    ...(credits === undefined ? {} : { credits }),
  };
}

export async function findCursorDashboardJson({
  queryTabs,
  executeScript,
}: CursorDashboardBridge): Promise<CursorDashboardJson | undefined> {
  try {
    const tabs = await queryTabs({ url: "https://cursor.com/*" });
    const tabId = tabs.find((tab) => tab.id !== undefined)?.id;
    if (tabId === undefined) return undefined;

    const [injection] = await executeScript({
      target: { tabId },
      world: "MAIN",
      func: readCursorDashboardJsonAtExpectedOrigin,
    });
    const result = injection?.result;
    return typeof result === "object" && result !== null && !Array.isArray(result)
      ? (result as CursorDashboardJson)
      : undefined;
  } catch {
    return undefined;
  }
}
