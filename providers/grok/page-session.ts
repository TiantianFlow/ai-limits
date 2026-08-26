import type { ProviderHealth } from "../../domain/model";

export const GROK_OWNED_TAB_URL = "https://grok.com/";
export const GROK_OWNED_TAB_LEASE_PREFIX = "grokSessionTabLease";
export const GROK_OWNED_TAB_TIMEOUT_MS = 10_000;

export type GrokJsonEndpointResult = {
  readonly ok: boolean;
  readonly status: number;
  readonly contentType: string;
  readonly json?: unknown;
  readonly text?: string;
};

export type GrokBinaryEndpointResult = {
  readonly ok: boolean;
  readonly status: number;
  readonly contentType: string;
  readonly grpcStatus?: string;
  readonly grpcMessage?: string;
  readonly bodyBase64?: string;
};

export type GrokPageRead = {
  readonly kind: "read";
  readonly session: GrokJsonEndpointResult;
  readonly pool: GrokBinaryEndpointResult;
  readonly rateLimits: Readonly<Record<string, GrokJsonEndpointResult>>;
  readonly subscriptions: GrokJsonEndpointResult;
};

export type GrokPageProbe =
  | { readonly kind: "no_tab" }
  | { readonly kind: "permission_missing" }
  | { readonly kind: "inject_threw"; readonly detail: string }
  | { readonly kind: "inject_empty"; readonly detail: string }
  | { readonly kind: "inject_unusable"; readonly detail: string }
  | { readonly kind: "wrong_origin"; readonly origin: string }
  | { readonly kind: "tab_asleep" }
  | GrokPageRead;

interface GrokTab {
  id?: number;
  url?: string;
  discarded?: boolean;
  status?: string;
}

interface GrokScriptResult {
  result?: unknown;
}

type InjectedGrokFunc =
  | typeof readGrokPageSessionAtExpectedOrigin
  | typeof startGrokPageSessionStashAtExpectedOrigin
  | typeof readGrokPageSessionStashAtExpectedOrigin
  | typeof clearGrokPageSessionStashAtExpectedOrigin;

export interface GrokPageBridge {
  hasPagePermission(): Promise<boolean>;
  queryTabs(details: { url: string }): Promise<GrokTab[]>;
  executeScript(details: {
    target: { tabId: number };
    world: "MAIN";
    func: InjectedGrokFunc;
  }): Promise<GrokScriptResult[]>;
  now?(): number;
  delay?(ms: number): Promise<void>;
  openOwnedTab?(): Promise<{ tabId: number; release: () => void } | undefined>;
}

const STASH_BUDGET_MS = 8_000;
const STASH_POLL_MS = 200;

function emptyJsonResult(): GrokJsonEndpointResult {
  return { ok: false, status: 0, contentType: "none" };
}

function emptyBinaryResult(): GrokBinaryEndpointResult {
  return { ok: false, status: 0, contentType: "none" };
}

export function tabLooksAsleep(tab: GrokTab): boolean {
  if (tab.discarded === true) return true;
  return tab.status !== undefined && tab.status !== "complete";
}

export function rankGrokTabs(tabs: readonly GrokTab[]): number[] {
  return tabs
    .flatMap((tab) =>
      tab.id === undefined
        ? []
        : [{ id: tab.id, url: tab.url, asleep: tabLooksAsleep(tab) }],
    )
    .sort((left, right) => Number(left.asleep) - Number(right.asleep))
    .map((tab) => tab.id);
}

export async function readGrokPageSessionAtExpectedOrigin(
  fetchPage: typeof globalThis.fetch = globalThis.fetch,
  currentOrigin: string = globalThis.location.origin,
): Promise<
  | Omit<GrokPageRead, "kind">
  | { readonly declined: "wrong_origin"; readonly origin: string }
> {
  if (currentOrigin !== "https://grok.com") {
    return { declined: "wrong_origin", origin: currentOrigin };
  }

  const readJson = async (
    url: string,
    init: RequestInit,
  ): Promise<GrokJsonEndpointResult> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await fetchPage(url, {
        ...init,
        credentials: "include",
        signal: abortController.signal,
      });
      const contentType = response.headers.get("content-type") ?? "none";
      const text = await response.text();
      try {
        return {
          ok: response.ok,
          status: response.status,
          contentType,
          json: JSON.parse(text) as unknown,
        };
      } catch {
        return {
          ok: response.ok,
          status: response.status,
          contentType,
          text: text.slice(0, 160),
        };
      }
    } catch {
      return { ok: false, status: 0, contentType: "none" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const readBinary = async (
    url: string,
    init: RequestInit,
  ): Promise<GrokBinaryEndpointResult> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await fetchPage(url, {
        ...init,
        credentials: "include",
        signal: abortController.signal,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]!);
      }
      const grpcStatus = response.headers.get("grpc-status") ?? undefined;
      const grpcMessage = response.headers.get("grpc-message") ?? undefined;
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "none",
        ...(grpcStatus === undefined || grpcStatus.trim() === ""
          ? {}
          : { grpcStatus }),
        ...(grpcMessage === undefined || grpcMessage.trim() === ""
          ? {}
          : { grpcMessage }),
        bodyBase64: btoa(binary),
      };
    } catch {
      return { ok: false, status: 0, contentType: "none" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const jsonHeaders = {
    Accept: "application/json",
  };
  const [session, pool, subscriptions, fast, expert, heavy, auto] =
    await Promise.all([
      readJson("https://grok.com/api/auth/session", {
        method: "GET",
        headers: jsonHeaders,
      }),
      readBinary(
        "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
        {
          method: "POST",
          headers: {
            Accept: "application/grpc-web+proto",
            "Content-Type": "application/grpc-web+proto",
            "X-Grpc-Web": "1",
          },
          body: new Uint8Array([0, 0, 0, 0, 0]),
        },
      ),
      readJson("https://grok.com/rest/subscriptions", {
        method: "GET",
        headers: jsonHeaders,
      }),
      readJson("https://grok.com/rest/rate-limits", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelName: "fast" }),
      }),
      readJson("https://grok.com/rest/rate-limits", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelName: "expert" }),
      }),
      readJson("https://grok.com/rest/rate-limits", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelName: "heavy" }),
      }),
      readJson("https://grok.com/rest/rate-limits", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelName: "auto" }),
      }),
    ]);

  return {
    session,
    pool,
    rateLimits: { fast, expert, heavy, auto },
    subscriptions,
  };
}

export function startGrokPageSessionStashAtExpectedOrigin(
  currentOrigin: string = globalThis.location.origin,
):
  | { readonly started: true }
  | { readonly declined: "wrong_origin"; readonly origin: string } {
  if (currentOrigin !== "https://grok.com") {
    return { declined: "wrong_origin", origin: currentOrigin };
  }
  const stashKey = "__aiLimitsGrokSessionV1";
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  target[stashKey] = { status: "pending" };

  const readJson = async (
    url: string,
    init: RequestInit,
  ): Promise<GrokJsonEndpointResult> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await globalThis.fetch(url, {
        ...init,
        credentials: "include",
        signal: abortController.signal,
      });
      const contentType = response.headers.get("content-type") ?? "none";
      const text = await response.text();
      try {
        return {
          ok: response.ok,
          status: response.status,
          contentType,
          json: JSON.parse(text) as unknown,
        };
      } catch {
        return {
          ok: response.ok,
          status: response.status,
          contentType,
          text: text.slice(0, 160),
        };
      }
    } catch {
      return { ok: false, status: 0, contentType: "none" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const readBinary = async (
    url: string,
    init: RequestInit,
  ): Promise<GrokBinaryEndpointResult> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await globalThis.fetch(url, {
        ...init,
        credentials: "include",
        signal: abortController.signal,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]!);
      }
      const grpcStatus = response.headers.get("grpc-status") ?? undefined;
      const grpcMessage = response.headers.get("grpc-message") ?? undefined;
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "none",
        ...(grpcStatus === undefined || grpcStatus.trim() === ""
          ? {}
          : { grpcStatus }),
        ...(grpcMessage === undefined || grpcMessage.trim() === ""
          ? {}
          : { grpcMessage }),
        bodyBase64: btoa(binary),
      };
    } catch {
      return { ok: false, status: 0, contentType: "none" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const jsonHeaders = {
    Accept: "application/json",
  };
  void Promise.all([
    readJson("https://grok.com/api/auth/session", {
      method: "GET",
      headers: jsonHeaders,
    }),
    readBinary(
      "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
      {
        method: "POST",
        headers: {
          Accept: "application/grpc-web+proto",
          "Content-Type": "application/grpc-web+proto",
          "X-Grpc-Web": "1",
        },
        body: new Uint8Array([0, 0, 0, 0, 0]),
      },
    ),
    readJson("https://grok.com/rest/subscriptions", {
      method: "GET",
      headers: jsonHeaders,
    }),
    readJson("https://grok.com/rest/rate-limits", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ modelName: "fast" }),
    }),
    readJson("https://grok.com/rest/rate-limits", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ modelName: "expert" }),
    }),
    readJson("https://grok.com/rest/rate-limits", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ modelName: "heavy" }),
    }),
    readJson("https://grok.com/rest/rate-limits", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ modelName: "auto" }),
    }),
  ])
    .then(([session, pool, subscriptions, fast, expert, heavy, auto]) => {
      target[stashKey] = {
        status: "ready",
        session,
        pool,
        rateLimits: { fast, expert, heavy, auto },
        subscriptions,
      };
    })
    .catch(() => {
      target[stashKey] = { status: "failed" };
    });
  return { started: true };
}

export function readGrokPageSessionStashAtExpectedOrigin(): unknown {
  const stashKey = "__aiLimitsGrokSessionV1";
  return (globalThis as typeof globalThis & Record<string, unknown>)[stashKey];
}

export function clearGrokPageSessionStashAtExpectedOrigin(): {
  readonly cleared: true;
} {
  const stashKey = "__aiLimitsGrokSessionV1";
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  try {
    delete target[stashKey];
  } catch {
    target[stashKey] = undefined;
  }
  return { cleared: true };
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

export function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function describeInjectedValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (isThenable(value)) return `thenable typeof=${typeof value}`;
  return typeof value;
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

function asJsonEndpoint(value: unknown): GrokJsonEndpointResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyJsonResult();
  }
  const record = value as {
    ok?: unknown;
    status?: unknown;
    contentType?: unknown;
    json?: unknown;
    text?: unknown;
  };
  const status =
    typeof record.status === "number" &&
    Number.isInteger(record.status) &&
    record.status >= 0 &&
    record.status <= 599
      ? record.status
      : 0;
  const contentType =
    typeof record.contentType === "string" && record.contentType.trim()
      ? record.contentType.slice(0, 128)
      : "none";
  return {
    ok: record.ok === true,
    status,
    contentType,
    ...(Object.hasOwn(record, "json") ? { json: record.json } : {}),
    ...(typeof record.text === "string"
      ? { text: record.text.slice(0, 160) }
      : {}),
  };
}

function asBinaryEndpoint(value: unknown): GrokBinaryEndpointResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyBinaryResult();
  }
  const record = value as {
    ok?: unknown;
    status?: unknown;
    contentType?: unknown;
    grpcStatus?: unknown;
    grpcMessage?: unknown;
    bodyBase64?: unknown;
  };
  const status =
    typeof record.status === "number" &&
    Number.isInteger(record.status) &&
    record.status >= 0 &&
    record.status <= 599
      ? record.status
      : 0;
  const contentType =
    typeof record.contentType === "string" && record.contentType.trim()
      ? record.contentType.slice(0, 128)
      : "none";
  return {
    ok: record.ok === true,
    status,
    contentType,
    ...(typeof record.grpcStatus === "string" && record.grpcStatus.trim()
      ? { grpcStatus: record.grpcStatus.slice(0, 32) }
      : {}),
    ...(typeof record.grpcMessage === "string" && record.grpcMessage.trim()
      ? { grpcMessage: record.grpcMessage.slice(0, 160) }
      : {}),
    ...(typeof record.bodyBase64 === "string"
      ? { bodyBase64: record.bodyBase64 }
      : {}),
  };
}

function asRateLimits(
  value: unknown,
): Readonly<Record<string, GrokJsonEndpointResult>> {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    fast: asJsonEndpoint(record.fast),
    expert: asJsonEndpoint(record.expert),
    heavy: asJsonEndpoint(record.heavy),
    auto: asJsonEndpoint(record.auto),
  };
}

function asReadResult(value: unknown): GrokPageRead | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as {
    declined?: unknown;
    session?: unknown;
    pool?: unknown;
    rateLimits?: unknown;
    subscriptions?: unknown;
  };
  if (record.declined !== undefined) return undefined;
  if (
    record.session === undefined &&
    record.pool === undefined &&
    record.subscriptions === undefined
  ) {
    return undefined;
  }
  return {
    kind: "read",
    session: asJsonEndpoint(record.session),
    pool: asBinaryEndpoint(record.pool),
    rateLimits: asRateLimits(record.rateLimits),
    subscriptions: asJsonEndpoint(record.subscriptions),
  };
}

type InjectFailure = Extract<
  GrokPageProbe,
  { kind: "inject_threw" | "inject_empty" | "inject_unusable" }
>;

async function runInjected(
  executeScript: GrokPageBridge["executeScript"],
  tabId: number,
  func: InjectedGrokFunc,
): Promise<{ readonly kind: "value"; readonly value: unknown } | InjectFailure> {
  try {
    const frames = await executeScript({
      target: { tabId },
      world: "MAIN",
      func,
    });
    if (!Array.isArray(frames) || frames.length === 0) {
      return { kind: "inject_empty", detail: "executeScript returned no frames" };
    }
    if (
      !Object.hasOwn(frames[0] as object, "result") &&
      frames[0]?.result === undefined
    ) {
      return { kind: "inject_empty", detail: "injection.result was undefined" };
    }
    const result = frames[0]?.result;
    if (result === undefined) {
      return { kind: "inject_empty", detail: "injection.result was undefined" };
    }
    if (result === null) {
      return { kind: "inject_empty", detail: "injection.result was null" };
    }
    if (isThenable(result)) {
      return { kind: "inject_unusable", detail: describeInjectedValue(result) };
    }
    return { kind: "value", value: result };
  } catch (error) {
    return { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
  }
}

async function readStashFallback(
  executeScript: GrokPageBridge["executeScript"],
  tabId: number,
  now: () => number,
  delay: (ms: number) => Promise<void>,
): Promise<
  | Extract<GrokPageProbe, { kind: "read" | "wrong_origin" }>
  | InjectFailure
> {
  const started = await runInjected(
    executeScript,
    tabId,
    startGrokPageSessionStashAtExpectedOrigin,
  );
  if (started.kind !== "value") return started;
  const wrongOrigin = asWrongOrigin(started.value);
  if (wrongOrigin) return wrongOrigin;
  if (
    typeof started.value !== "object" ||
    started.value === null ||
    Array.isArray(started.value) ||
    (started.value as { started?: unknown }).started !== true
  ) {
    return {
      kind: "inject_unusable",
      detail: `two-step start ${describeInjectedValue(started.value)}`,
    };
  }

  const deadline = now() + STASH_BUDGET_MS;
  try {
    while (now() < deadline) {
      await delay(STASH_POLL_MS);
      const polled = await runInjected(
        executeScript,
        tabId,
        readGrokPageSessionStashAtExpectedOrigin,
      );
      if (polled.kind !== "value") return polled;
      if (polled.value === undefined || polled.value === null) continue;
      if (typeof polled.value !== "object" || Array.isArray(polled.value)) {
        return {
          kind: "inject_unusable",
          detail: `two-step stash ${describeInjectedValue(polled.value)}`,
        };
      }
      const stash = polled.value as {
        status?: unknown;
        session?: unknown;
        pool?: unknown;
        rateLimits?: unknown;
        subscriptions?: unknown;
      };
      if (stash.status === "pending") continue;
      if (stash.status === "failed") {
        return { kind: "inject_empty", detail: "two-step stash failed" };
      }
      if (stash.status === "ready") {
        const read = asReadResult({
          session: stash.session,
          pool: stash.pool,
          rateLimits: stash.rateLimits,
          subscriptions: stash.subscriptions,
        });
        if (read) return read;
        return {
          kind: "inject_unusable",
          detail: "two-step stash ready payload was unusable",
        };
      }
    }
    return { kind: "inject_empty", detail: "two-step stash timed out" };
  } finally {
    await runInjected(
      executeScript,
      tabId,
      clearGrokPageSessionStashAtExpectedOrigin,
    );
  }
}

async function injectIntoTabIds(
  tabIds: readonly number[],
  executeScript: GrokPageBridge["executeScript"],
  now: () => number,
  delay: (ms: number) => Promise<void>,
): Promise<{
  probe?: GrokPageRead;
  lastWrongOrigin?: { kind: "wrong_origin"; origin: string };
  firstFailure?: InjectFailure;
}> {
  let lastWrongOrigin: { kind: "wrong_origin"; origin: string } | undefined;
  let firstFailure: InjectFailure | undefined;
  for (const tabId of tabIds) {
    const direct = await runInjected(
      executeScript,
      tabId,
      readGrokPageSessionAtExpectedOrigin,
    );
    if (direct.kind === "value") {
      const wrongOrigin = asWrongOrigin(direct.value);
      if (wrongOrigin) {
        lastWrongOrigin = wrongOrigin;
        continue;
      }
      if (!isThenable(direct.value)) {
        const read = asReadResult(direct.value);
        if (read) return { probe: read };
      }
      firstFailure ??= {
        kind: "inject_unusable",
        detail: describeInjectedValue(direct.value),
      };
    } else if (direct.kind === "inject_threw") {
      firstFailure ??= direct;
      continue;
    } else {
      firstFailure ??= direct;
    }

    const fallback = await readStashFallback(executeScript, tabId, now, delay);
    if (fallback.kind === "read") return { probe: fallback };
    if (fallback.kind === "wrong_origin") {
      lastWrongOrigin = fallback;
      continue;
    }
    firstFailure = fallback.detail.startsWith("two-step stash")
      ? fallback
      : (firstFailure ?? fallback);
  }
  return { lastWrongOrigin, firstFailure };
}

export async function findGrokPageSession({
  hasPagePermission,
  queryTabs,
  executeScript,
  now = Date.now,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  openOwnedTab,
}: GrokPageBridge): Promise<GrokPageProbe> {
  try {
    if (!(await hasPagePermission())) return { kind: "permission_missing" };
    const tabs = await queryTabs({ url: "https://grok.com/*" });
    const candidates = tabs.filter((tab) => tab.id !== undefined);
    if (candidates.length === 0) {
      if (!openOwnedTab) return { kind: "no_tab" };
      const owned = await openOwnedTab();
      if (!owned) return { kind: "no_tab" };
      try {
        const opened = await injectIntoTabIds(
          [owned.tabId],
          executeScript,
          now,
          delay,
        );
        return (
          opened.probe ??
          opened.lastWrongOrigin ??
          opened.firstFailure ?? { kind: "no_tab" }
        );
      } finally {
        owned.release();
      }
    }
    const onlyAsleep = candidates.every(tabLooksAsleep);
    const existing = await injectIntoTabIds(
      rankGrokTabs(candidates),
      executeScript,
      now,
      delay,
    );
    if (existing.probe) return existing.probe;
    if (existing.lastWrongOrigin) return existing.lastWrongOrigin;
    if (onlyAsleep) return { kind: "tab_asleep" };
    return (
      existing.firstFailure ?? {
        kind: "inject_empty",
        detail: "no injection attempt produced a result",
      }
    );
  } catch (error) {
    return { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
  }
}

export function healthFromGrokPageProbe(
  probe: Exclude<GrokPageProbe, { kind: "read" }>,
): ProviderHealth {
  const detail =
    probe.kind === "inject_threw" ||
    probe.kind === "inject_empty" ||
    probe.kind === "inject_unusable"
      ? probe.detail
      : probe.kind === "wrong_origin"
        ? probe.origin
        : undefined;
  const message =
    detail === undefined
      ? `page-probe: ${probe.kind}`
      : `page-probe: ${probe.kind}: ${detail}`;
  if (
    probe.kind === "no_tab" ||
    probe.kind === "tab_asleep" ||
    probe.kind === "permission_missing"
  ) {
    return { kind: "temporary_error", message };
  }
  return { kind: "provider_changed", message };
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function jsonResponse(result: GrokJsonEndpointResult): Response {
  const body =
    result.json !== undefined
      ? JSON.stringify(result.json)
      : (result.text ?? "");
  return new Response(body, {
    status: result.status === 0 ? 599 : result.status,
    headers: { "content-type": result.contentType },
  });
}

function binaryResponse(result: GrokBinaryEndpointResult): Response {
  const headers = new Headers({ "content-type": result.contentType });
  if (result.grpcStatus !== undefined) {
    headers.set("grpc-status", result.grpcStatus);
  }
  if (result.grpcMessage !== undefined) {
    headers.set("grpc-message", result.grpcMessage);
  }
  const body =
    result.bodyBase64 === undefined
      ? new Uint8Array()
      : bytesFromBase64(result.bodyBase64);
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return new Response(copy, {
    status: result.status === 0 ? 599 : result.status,
    headers,
  });
}

function rateLimitMode(init?: RequestInit): string | undefined {
  try {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as {
      modelName?: unknown;
    };
    return typeof parsed.modelName === "string" ? parsed.modelName : undefined;
  } catch {
    return undefined;
  }
}

export function fetchFromGrokPageRead(
  read: GrokPageRead,
  signal: AbortSignal,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const href = String(input);
    if (href.includes("/api/auth/session")) {
      return jsonResponse(read.session);
    }
    if (href.includes("GetGrokCreditsConfig")) {
      return binaryResponse(read.pool);
    }
    if (href.includes("/rest/rate-limits")) {
      const mode = rateLimitMode(init);
      return jsonResponse(
        mode === undefined
          ? emptyJsonResult()
          : (read.rateLimits[mode] ?? emptyJsonResult()),
      );
    }
    if (href.includes("/rest/subscriptions")) {
      return jsonResponse(read.subscriptions);
    }
    return new Response("{}", {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
}
