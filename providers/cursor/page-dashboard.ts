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
  | { readonly kind: "permission_missing" }
  | { readonly kind: "inject_threw"; readonly detail: string }
  | { readonly kind: "inject_empty"; readonly detail: string }
  | { readonly kind: "inject_unusable"; readonly detail: string }
  | { readonly kind: "wrong_origin"; readonly origin: string }
  | { readonly kind: "tab_asleep" }
  | {
      readonly kind: "read";
      readonly grok: CursorDashboardEndpointResult;
      readonly credits: CursorDashboardEndpointResult;
      readonly aggregated: CursorDashboardEndpointResult;
    };

interface CursorTab {
  id?: number;
  url?: string;
  discarded?: boolean;
  status?: string;
}

interface CursorScriptResult {
  result?: unknown;
}

interface CursorDashboardBridge {
  hasPagePermission(): Promise<boolean>;
  queryTabs(details: { url: string }): Promise<CursorTab[]>;
  executeScript(details: {
    target: { tabId: number };
    world: "MAIN";
    func: typeof readCursorDashboardJsonAtExpectedOrigin;
  }): Promise<CursorScriptResult[]>;
}

const EXPECTED_ORIGIN = "https://cursor.com";

function asEndpointResult(value: unknown): CursorDashboardEndpointResult {
  if (value === undefined) return { ok: false };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
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
  return { ok: true, value };
}

export function tabLooksAsleep(tab: CursorTab): boolean {
  if (tab.discarded === true) return true;
  return tab.status !== undefined && tab.status !== "complete";
}

export function rankCursorTabs(tabs: readonly CursorTab[]): number[] {
  return tabs
    .flatMap((tab) =>
      tab.id === undefined
        ? []
        : [{ id: tab.id, url: tab.url, asleep: tabLooksAsleep(tab) }],
    )
    .sort((left, right) => {
      const pathDelta = cursorTabScore(left.url) - cursorTabScore(right.url);
      if (pathDelta !== 0) return pathDelta;
      return Number(left.asleep) - Number(right.asleep);
    })
    .map((tab) => tab.id);
}

function cursorTabScore(url: string | undefined): number {
  if (url === undefined) return 4;
  try {
    const path = new URL(url).pathname;
    if (path === "/dashboard/spending" || path.startsWith("/dashboard/spending/")) {
      return 0;
    }
    if (path === "/dashboard" || path.startsWith("/dashboard/")) return 1;
    if (path === "/settings" || path.startsWith("/settings/")) return 2;
    if (path === "/" || path === "") return 4;
    return 3;
  } catch {
    return 5;
  }
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
  | { readonly declined: "wrong_origin"; readonly origin: string }
> {
  if (currentOrigin !== EXPECTED_ORIGIN) {
    return { declined: "wrong_origin", origin: currentOrigin };
  }

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

function asWrongOrigin(
  value: unknown,
): { readonly kind: "wrong_origin"; readonly origin: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { declined?: unknown; origin?: unknown };
  if (record.declined !== "wrong_origin" || typeof record.origin !== "string") {
    return undefined;
  }
  const origin = record.origin.trim();
  if (origin.length === 0 || origin.length > 128) return undefined;
  return { kind: "wrong_origin", origin };
}

export function sanitizeInjectDetail(value: unknown): string {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : Object.prototype.toString.call(value);
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return compact.length > 0 ? compact : "unknown";
}

function describeInjectedValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  return typeof value;
}

function asReadResult(value: unknown): Extract<CursorDashboardProbe, { kind: "read" }> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as {
    declined?: unknown;
    grok?: unknown;
    credits?: unknown;
    aggregated?: unknown;
  };
  if (record.declined !== undefined) return undefined;
  return {
    kind: "read",
    grok: asEndpointResult(record.grok),
    credits: asEndpointResult(record["credits"]),
    aggregated: asEndpointResult(record.aggregated),
  };
}

export async function findCursorDashboardJson({
  hasPagePermission,
  queryTabs,
  executeScript,
}: CursorDashboardBridge): Promise<CursorDashboardProbe> {
  try {
    if (!(await hasPagePermission())) return { kind: "permission_missing" };
    const tabs = await queryTabs({ url: "https://cursor.com/*" });
    const candidates = tabs.filter((tab) => tab.id !== undefined);
    if (candidates.length === 0) return { kind: "no_tab" };
    const onlyAsleep = candidates.every(tabLooksAsleep);
    const tabIds = rankCursorTabs(candidates);

    let lastWrongOrigin: { kind: "wrong_origin"; origin: string } | undefined;
    let firstFailure:
      | Extract<
          CursorDashboardProbe,
          { kind: "inject_threw" | "inject_empty" | "inject_unusable" }
        >
      | undefined;
    for (const tabId of tabIds) {
      try {
        const frames = await executeScript({
          target: { tabId },
          world: "MAIN",
          func: readCursorDashboardJsonAtExpectedOrigin,
        });
        if (!Array.isArray(frames) || frames.length === 0) {
          firstFailure ??= {
            kind: "inject_empty",
            detail: "executeScript returned no frames",
          };
          continue;
        }
        const result = frames[0]?.result;
        if (result === undefined) {
          firstFailure ??= {
            kind: "inject_empty",
            detail: "injection.result was undefined",
          };
          continue;
        }
        const wrongOrigin = asWrongOrigin(result);
        if (wrongOrigin) {
          lastWrongOrigin = wrongOrigin;
          continue;
        }
        const read = asReadResult(result);
        if (read) return read;
        firstFailure ??= {
          kind: "inject_unusable",
          detail: describeInjectedValue(result),
        };
      } catch (error) {
        firstFailure ??= {
          kind: "inject_threw",
          detail: sanitizeInjectDetail(error),
        };
      }
    }
    if (lastWrongOrigin) return lastWrongOrigin;
    if (onlyAsleep) return { kind: "tab_asleep" };
    return (
      firstFailure ?? {
        kind: "inject_empty",
        detail: "no injection attempt produced a result",
      }
    );
  } catch (error) {
    return { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
  }
}
