export interface CursorDashboardJson {
  readonly grok?: unknown;
  readonly credits?: unknown;
  readonly aggregated?: unknown;
}

export type CursorDashboardEndpointResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status?: number };

export type CursorDashboardProbe =
  | { readonly kind: "no_tab" }
  | { readonly kind: "injection_failed" }
  | {
      readonly kind: "read";
      readonly grok: CursorDashboardEndpointResult;
      readonly credits: CursorDashboardEndpointResult;
      readonly aggregated: CursorDashboardEndpointResult;
    };

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

function asEndpointResult(value: unknown): CursorDashboardEndpointResult | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { ok?: unknown; value?: unknown; status?: unknown };
  if (record.ok === true) return { ok: true, value: record.value };
  if (record.ok === false) {
    return typeof record.status === "number" &&
      Number.isInteger(record.status) &&
      record.status >= 100 &&
      record.status <= 599
      ? { ok: false, status: record.status }
      : { ok: false };
  }
  return undefined;
}

export async function readCursorDashboardJsonAtExpectedOrigin(
  fetchPage: typeof globalThis.fetch = globalThis.fetch,
  currentOrigin: string = globalThis.location.origin,
): Promise<
  | {
      readonly grok: CursorDashboardEndpointResult;
      readonly credits: CursorDashboardEndpointResult;
      readonly aggregated: CursorDashboardEndpointResult;
    }
  | undefined
> {
  if (currentOrigin !== "https://cursor.com") return undefined;

  const readJson = async (url: string): Promise<CursorDashboardEndpointResult> => {
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
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // These POSTs must stay same-origin. A service-worker fetch is rejected
  // with 403 "Invalid origin for state-changing request".
  const [grok, credits, aggregated] = await Promise.all([
    readJson("https://cursor.com/api/dashboard/get-sand-usage-status"),
    readJson("https://cursor.com/api/dashboard/get-credit-grants-balance"),
    readJson("https://cursor.com/api/dashboard/get-aggregated-usage-events"),
  ]);
  return { grok, credits, aggregated };
}

export function dashboardJsonFromProbe(
  probe: CursorDashboardProbe,
): CursorDashboardJson {
  if (probe.kind !== "read") return {};
  return {
    ...(probe.grok.ok ? { grok: probe.grok.value } : {}),
    ...(probe["credits"].ok ? { credits: probe["credits"].value } : {}),
    ...(probe.aggregated.ok ? { aggregated: probe.aggregated.value } : {}),
  };
}

export async function findCursorDashboardJson({
  queryTabs,
  executeScript,
}: CursorDashboardBridge): Promise<CursorDashboardProbe> {
  try {
    const tabs = await queryTabs({ url: "https://cursor.com/*" });
    const tabId = tabs.find((tab) => tab.id !== undefined)?.id;
    if (tabId === undefined) return { kind: "no_tab" };

    const [injection] = await executeScript({
      target: { tabId },
      world: "MAIN",
      func: readCursorDashboardJsonAtExpectedOrigin,
    });
    const result = injection?.result;
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      return { kind: "injection_failed" };
    }
    const grok = asEndpointResult((result as { grok?: unknown }).grok);
    const credits = asEndpointResult((result as { credits?: unknown })["credits"]);
    const aggregated = asEndpointResult(
      (result as { aggregated?: unknown }).aggregated,
    );
    if (
      grok === undefined ||
      credits === undefined ||
      aggregated === undefined
    ) {
      return { kind: "injection_failed" };
    }
    return { kind: "read", grok, credits, aggregated };
  } catch {
    return { kind: "injection_failed" };
  }
}
