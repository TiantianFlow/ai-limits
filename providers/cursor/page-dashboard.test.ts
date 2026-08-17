import { describe, expect, test, vi } from "vitest";

import {
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
      .mockResolvedValueOnce(jsonResponse(credits));

    await expect(
      readCursorDashboardJsonAtExpectedOrigin(
        fetchPage,
        "https://cursor.com",
      ),
    ).resolves.toEqual({ grok, credits });

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
    expect(fetchPage).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce(jsonResponse(credits));

    await expect(
      readCursorDashboardJsonAtExpectedOrigin(
        fetchPage,
        "https://cursor.com",
      ),
    ).resolves.toEqual({ credits });
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

      await expect(result).resolves.toEqual({});
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(
        fetchPage.mock.calls.map(([, init]) => init?.signal?.aborted),
      ).toEqual([true, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("injects into one current Cursor tab in MAIN world without any tab mutation capability", async () => {
    const dashboard = { grok: { usagePercent: 25 } };
    const queryTabs = vi.fn().mockResolvedValue([{ id: undefined }, { id: 17 }]);
    const executeScript = vi.fn().mockResolvedValue([{ result: dashboard }]);

    await expect(
      findCursorDashboardJson({ queryTabs, executeScript }),
    ).resolves.toEqual(dashboard);

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
    ).resolves.toBeUndefined();
    expect(executeScript).not.toHaveBeenCalled();
  });
});
