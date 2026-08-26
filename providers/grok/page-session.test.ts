import { describe, expect, test, vi } from "vitest";

import {
  EMPTY_GRPC_WEB_UNARY,
  GRPC_WEB_CONTENT_TYPE,
} from "./grpc-web";
import {
  clearGrokPageSessionStashAtExpectedOrigin,
  fetchFromGrokPageRead,
  findGrokPageSession,
  healthFromGrokPageProbe,
  rankGrokTabs,
  readGrokPageSessionAtExpectedOrigin,
  readGrokPageSessionStashAtExpectedOrigin,
  startGrokPageSessionStashAtExpectedOrigin,
  tabLooksAsleep,
  type GrokPageRead,
} from "./page-session";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const granted = vi.fn().mockResolvedValue(true);

const SESSION = { status: "authenticated", session: { userId: "user-test" } };

function pageRead(overrides: Partial<Omit<GrokPageRead, "kind">> = {}): GrokPageRead {
  return {
    kind: "read",
    session: { ok: true, status: 200, contentType: "application/json", json: SESSION },
    pool: {
      ok: true,
      status: 200,
      contentType: GRPC_WEB_CONTENT_TYPE,
      bodyBase64: btoa("pool"),
    },
    rateLimits: {
      fast: { ok: true, status: 200, contentType: "application/json", json: { modelName: "fast" } },
      expert: { ok: true, status: 200, contentType: "application/json", json: { modelName: "expert" } },
      heavy: { ok: true, status: 200, contentType: "application/json", json: { modelName: "heavy" } },
      auto: { ok: true, status: 200, contentType: "application/json", json: { modelName: "auto" } },
    },
    subscriptions: {
      ok: true,
      status: 200,
      contentType: "application/json",
      json: { subscriptions: [] },
    },
    ...overrides,
  };
}

describe("Grok page session bridge", () => {
  test("reads session, pool, subscriptions, and chat modes from the exact Grok origin", async () => {
    const session = SESSION;
    const subscriptions = { subscriptions: [] };
    const fetchPage = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const href = String(url);
      if (href.endsWith("/api/auth/session")) return jsonResponse(session);
      if (href.includes("GetGrokCreditsConfig")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": GRPC_WEB_CONTENT_TYPE },
        });
      }
      if (href.endsWith("/rest/subscriptions")) return jsonResponse(subscriptions);
      if (href.endsWith("/rest/rate-limits")) {
        return jsonResponse({ modelName: JSON.parse(String(init?.body)).modelName });
      }
      return jsonResponse({}, 404);
    });

    const result = await readGrokPageSessionAtExpectedOrigin(
      fetchPage,
      "https://grok.com",
    );
    expect(result).toEqual({
      session: {
        ok: true,
        status: 200,
        contentType: "application/json",
        json: session,
      },
      pool: {
        ok: true,
        status: 200,
        contentType: GRPC_WEB_CONTENT_TYPE,
        bodyBase64: btoa(String.fromCharCode(1, 2, 3)),
      },
      rateLimits: {
        fast: {
          ok: true,
          status: 200,
          contentType: "application/json",
          json: { modelName: "fast" },
        },
        expert: {
          ok: true,
          status: 200,
          contentType: "application/json",
          json: { modelName: "expert" },
        },
        heavy: {
          ok: true,
          status: 200,
          contentType: "application/json",
          json: { modelName: "heavy" },
        },
        auto: {
          ok: true,
          status: 200,
          contentType: "application/json",
          json: { modelName: "auto" },
        },
      },
      subscriptions: {
        ok: true,
        status: 200,
        contentType: "application/json",
        json: subscriptions,
      },
    });
    expect(fetchPage).toHaveBeenCalledWith(
      "https://grok.com/api/auth/session",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(fetchPage).toHaveBeenCalledWith(
      "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: EMPTY_GRPC_WEB_UNARY,
      }),
    );
  });

  test("refuses to read from any non-Grok origin", async () => {
    const fetchPage = vi.fn<typeof globalThis.fetch>();
    await expect(
      readGrokPageSessionAtExpectedOrigin(fetchPage, "https://lookalike.example"),
    ).resolves.toEqual({
      declined: "wrong_origin",
      origin: "https://lookalike.example",
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  test("keeps injected functions self-contained for executeScript serialization", () => {
    const forbidden = [
      "SESSION_ENDPOINT",
      "RATE_LIMITS_ENDPOINT",
      "SUBSCRIPTIONS_ENDPOINT",
      "POOL_CONNECT_ENDPOINT",
      "GROK_RATE_LIMIT_MODEL_NAMES",
      "EXPECTED_ORIGIN",
      "GRPC_WEB_CONTENT_TYPE",
      "EMPTY_GRPC_WEB_UNARY",
      "STASH_KEY",
      "GROK_OWNED_TAB_URL",
    ];
    const fetchers = [
      readGrokPageSessionAtExpectedOrigin,
      startGrokPageSessionStashAtExpectedOrigin,
    ];
    const sources = [
      ...fetchers,
      readGrokPageSessionStashAtExpectedOrigin,
      clearGrokPageSessionStashAtExpectedOrigin,
    ].map((fn) => Function.prototype.toString.call(fn));
    for (const source of sources) {
      for (const name of forbidden) {
        expect(source).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
    for (const fn of fetchers) {
      expect(Function.prototype.toString.call(fn)).toContain("https://grok.com");
    }
  });

  test("does not inject when scripting or host permission is missing", async () => {
    const executeScript = vi.fn();
    await expect(
      findGrokPageSession({
        hasPagePermission: vi.fn().mockResolvedValue(false),
        queryTabs: vi.fn(),
        executeScript,
      }),
    ).resolves.toEqual({ kind: "permission_missing" });
    expect(executeScript).not.toHaveBeenCalled();
  });

  test("returns no_tab when owned-tab creation is unavailable", async () => {
    const executeScript = vi.fn();
    await expect(
      findGrokPageSession({
        hasPagePermission: granted,
        queryTabs: vi.fn().mockResolvedValue([]),
        executeScript,
        openOwnedTab: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({ kind: "no_tab" });
    expect(executeScript).not.toHaveBeenCalled();
  });

  test("names an empty executeScript result separately from a throw", async () => {
    await expect(
      findGrokPageSession({
        hasPagePermission: granted,
        queryTabs: vi.fn().mockResolvedValue([
          { id: 7, url: "https://grok.com/", status: "complete" },
        ]),
        executeScript: vi.fn().mockResolvedValue([]),
      }),
    ).resolves.toEqual({
      kind: "inject_empty",
      detail: "executeScript returned no frames",
    });
  });

  test("names a null injection.result without reading started", async () => {
    await expect(
      findGrokPageSession({
        hasPagePermission: granted,
        queryTabs: vi.fn().mockResolvedValue([
          { id: 7, url: "https://grok.com/", status: "complete" },
        ]),
        executeScript: vi.fn().mockResolvedValue([{ result: null }]),
      }),
    ).resolves.toEqual({
      kind: "inject_empty",
      detail: "injection.result was null",
    });
  });

  test("names an undefined injection.result separately from a throw", async () => {
    await expect(
      findGrokPageSession({
        hasPagePermission: granted,
        queryTabs: vi.fn().mockResolvedValue([
          { id: 7, url: "https://grok.com/", status: "complete" },
        ]),
        executeScript: vi.fn().mockResolvedValue([{}]),
      }),
    ).resolves.toEqual({
      kind: "inject_empty",
      detail: "injection.result was undefined",
    });
  });

  test("falls back to a two-step stash when the direct read returns nothing usable", async () => {
    const payload = {
      session: { ok: true, status: 200, contentType: "application/json", json: SESSION },
      pool: { ok: true, status: 200, contentType: GRPC_WEB_CONTENT_TYPE, bodyBase64: "AA==" },
      rateLimits: {
        fast: { ok: true, status: 200, contentType: "application/json", json: {} },
        expert: { ok: true, status: 200, contentType: "application/json", json: {} },
        heavy: { ok: true, status: 200, contentType: "application/json", json: {} },
        auto: { ok: true, status: 200, contentType: "application/json", json: {} },
      },
      subscriptions: { ok: true, status: 200, contentType: "application/json", json: {} },
    };
    const executeScript = vi.fn().mockImplementation(async ({ func }) => {
      if (func === readGrokPageSessionAtExpectedOrigin) return [{}];
      if (func === startGrokPageSessionStashAtExpectedOrigin) {
        return [{ result: { started: true } }];
      }
      if (func === readGrokPageSessionStashAtExpectedOrigin) {
        return [{ result: { status: "ready", ...payload } }];
      }
      if (func === clearGrokPageSessionStashAtExpectedOrigin) {
        return [{ result: { cleared: true } }];
      }
      return [{}];
    });

    await expect(
      findGrokPageSession({
        hasPagePermission: granted,
        queryTabs: vi.fn().mockResolvedValue([{ id: 9, url: "https://grok.com/", status: "complete" }]),
        executeScript,
        now: () => 0,
        delay: async () => undefined,
      }),
    ).resolves.toEqual({
      kind: "read",
      ...payload,
    });
  });

  test("prefers awake grok.com tabs over discarded ones", () => {
    expect(
      rankGrokTabs([
        { id: 1, discarded: true, status: "unloaded" },
        { id: 2, status: "complete" },
      ]),
    ).toEqual([2, 1]);
    expect(tabLooksAsleep({ discarded: true })).toBe(true);
  });

  test("reconstructs adapter fetch from a page read and never hits the network", async () => {
    const read = pageRead();
    const signal = new AbortController().signal;
    const reconstructed = fetchFromGrokPageRead(read, signal);
    const session = await reconstructed("https://grok.com/api/auth/session", {
      method: "GET",
    });
    await expect(session.json()).resolves.toEqual(SESSION);
    const usage = await reconstructed("https://grok.com/rest/rate-limits", {
      method: "POST",
      body: JSON.stringify({ modelName: "fast" }),
    });
    await expect(usage.json()).resolves.toEqual({ modelName: "fast" });
    const missing = await reconstructed("https://example.com/other");
    expect(missing.status).toBe(404);
  });

  test("names page-probe failures instead of a generic provider_changed", () => {
    expect(healthFromGrokPageProbe({ kind: "permission_missing" })).toEqual({
      kind: "temporary_error",
      message: "page-probe: permission_missing",
    });
    expect(
      healthFromGrokPageProbe({
        kind: "inject_empty",
        detail: "injection.result was null",
      }),
    ).toEqual({
      kind: "provider_changed",
      message: "page-probe: inject_empty: injection.result was null",
    });
  });
});
