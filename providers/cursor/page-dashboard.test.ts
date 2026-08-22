import { describe, expect, test, vi } from "vitest";

import {
  dashboardJsonFromProbe,
  findCursorDashboardJson,
  readCursorDashboardJsonAtExpectedOrigin,
} from "./page-dashboard";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Cursor page dashboard bridge", () => {
  test("reads only the two fixed dashboard JSON responses from the exact Cursor origin", async () => {
    const grok = { usagePercent: 25 };
    const credits = { total_cents: 1_250, used_cents: 200 };
    const fetchPage = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(grok))
      .mockResolvedValueOnce(jsonResponse(credits))
      .mockResolvedValueOnce(jsonResponse({ aggregations: [] }));

    await expect(
      readCursorDashboardJsonAtExpectedOrigin(
        fetchPage,
        "https://cursor.com",
      ),
    ).resolves.toEqual({
      grok: { ok: true, value: grok },
      credits: { ok: true, value: credits },
      aggregated: { ok: true, value: { aggregations: [] } },
    });

    const request = {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: expect.any(AbortSignal),
    };
    expect(fetchPage).toHaveBeenNthCalledWith(
      1,
      "https://cursor.com/api/dashboard/get-sand-usage-status",
      request,
    );
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      "https://cursor.com/api/dashboard/get-credit-grants-balance",
      request,
    );
    expect(fetchPage).toHaveBeenNthCalledWith(
      3,
      "https://cursor.com/api/dashboard/get-aggregated-usage-events",
      request,
    );
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  test("refuses to read from any non-Cursor origin", async () => {
    const fetchPage = vi.fn<typeof globalThis.fetch>();

    await expect(
      readCursorDashboardJsonAtExpectedOrigin(
        fetchPage,
        "https://lookalike.example",
      ),
    ).resolves.toBeUndefined();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  test("returns only the independently available JSON response", async () => {
    const credits = { total_cents: 1_250, used_cents: 200 };
    const fetchPage = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("not json", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(credits))
      .mockResolvedValueOnce(new Response("not json", { status: 403 }));

    await expect(
      readCursorDashboardJsonAtExpectedOrigin(
        fetchPage,
        "https://cursor.com",
      ),
    ).resolves.toEqual({
      grok: { ok: false, status: 500 },
      credits: { ok: true, value: credits },
      aggregated: { ok: false, status: 403 },
    });
  });

  test("bounds stalled dashboard requests so base collection can continue", async () => {
    vi.useFakeTimers();
    try {
      const fetchPage = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error("missing request timeout signal");

        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      });

      const result = readCursorDashboardJsonAtExpectedOrigin(
        fetchPage,
        "https://cursor.com",
      );
      await vi.advanceTimersByTimeAsync(8_000);

      await expect(result).resolves.toEqual({
        grok: { ok: false },
        credits: { ok: false },
        aggregated: { ok: false },
      });
      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(
        fetchPage.mock.calls.map(([, init]) => init?.signal?.aborted),
      ).toEqual([true, true, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("injects into one current Cursor tab in MAIN world without any tab mutation capability", async () => {
    const dashboard = {
      grok: { ok: true as const, value: { usagePercent: 25 } },
      credits: { ok: false as const, status: 401 },
      aggregated: { ok: false as const, status: 403 },
    };
    const queryTabs = vi.fn().mockResolvedValue([{ id: undefined }, { id: 17 }]);
    const executeScript = vi.fn().mockResolvedValue([{ result: dashboard }]);

    await expect(
      findCursorDashboardJson({ queryTabs, executeScript }),
    ).resolves.toEqual({
      kind: "read",
      ...dashboard,
    });

    expect(queryTabs).toHaveBeenCalledWith({ url: "https://cursor.com/*" });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 17 },
      world: "MAIN",
      func: readCursorDashboardJsonAtExpectedOrigin,
    });
  });

  test("does not inject when no current Cursor tab exists", async () => {
    const executeScript = vi.fn();

    await expect(
      findCursorDashboardJson({
        queryTabs: vi.fn().mockResolvedValue([]),
        executeScript,
      }),
    ).resolves.toEqual({ kind: "no_tab" });
    expect(executeScript).not.toHaveBeenCalled();
  });

  test("maps injection exceptions to a failed probe instead of throwing", async () => {
    await expect(
      findCursorDashboardJson({
        queryTabs: vi.fn().mockRejectedValue(new Error("tabs failed")),
        executeScript: vi.fn(),
      }),
    ).resolves.toEqual({ kind: "injection_failed" });
  });

  test("extracts dashboard JSON only from successful endpoint reads", () => {
    expect(
      dashboardJsonFromProbe({
        kind: "read",
        grok: { ok: true, value: { usagePercent: 92 } },
        credits: { ok: false, status: 403 },
        aggregated: { ok: true, value: { aggregations: [] } },
      }),
    ).toEqual({
      grok: { usagePercent: 92 },
      aggregated: { aggregations: [] },
    });
    expect(dashboardJsonFromProbe({ kind: "no_tab" })).toEqual({});
  });
});
