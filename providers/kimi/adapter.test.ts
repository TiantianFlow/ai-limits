import { describe, expect, test, vi } from "vitest";

import { kimiAdapter } from "./adapter";

const NOW = 1_800_000_000_000;
const WEEKLY_RESET = "2030-01-20T12:00:00.000Z";
const FIVE_HOUR_RESET = "2030-01-15T10:00:00.000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    usages: [
      {
        scope: "FEATURE_CODING",
        detail: {
          limit: "1000",
          used: "250",
          remaining: "750",
          resetTime: WEEKLY_RESET,
        },
        limits: [
          {
            window: {
              duration: 300,
              timeUnit: "TIME_UNIT_MINUTE",
            },
            detail: {
              limit: "100",
              used: "25",
              remaining: "75",
              resetTime: FIVE_HOUR_RESET,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function codingUsage() {
  return fixture().usages[0] as {
    scope: string;
    detail: Record<string, unknown>;
    limits: Array<Record<string, unknown>>;
  };
}

function context(
  fetch: typeof globalThis.fetch,
  getCookie = vi.fn(),
  getAccessToken = vi.fn(),
) {
  return {
    fetch,
    getCookie,
    getAccessToken,
    now: NOW,
    signal: new AbortController().signal,
  };
}

describe("Kimi adapter", () => {
  test("strictly selects the coding record and normalizes weekly and five-hour windows", async () => {
    const getCookie = vi.fn().mockResolvedValue({ value: "secret-cookie" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        fixture({
          usages: [
            {
              scope: "FEATURE_CHAT",
              detail: { limit: "1", used: "0", resetTime: WEEKLY_RESET },
              limits: [],
            },
            codingUsage(),
          ],
        }),
      ),
    );

    const result = await kimiAdapter.collect(context(fetch, getCookie));

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerId: "kimi",
        source: "web-session",
        fetchedAt: NOW,
        windows: [
          {
            id: "weekly-coding",
            label: "Weekly coding",
            kind: "feature",
            usedRatio: 0.25,
            used: 250,
            limit: 1000,
            resetsAt: Date.parse(WEEKLY_RESET),
            durationMs: 7 * 24 * 60 * 60 * 1_000,
            sourceSemantics: "used",
          },
          {
            id: "five-hour-coding",
            label: "5-hour coding",
            kind: "feature",
            usedRatio: 0.25,
            used: 25,
            limit: 100,
            resetsAt: Date.parse(FIVE_HOUR_RESET),
            durationMs: 5 * 60 * 60 * 1_000,
            sourceSemantics: "used",
          },
        ],
        credits: [],
      },
    });
    expect(getCookie).toHaveBeenCalledWith({
      url: "https://www.kimi.com/",
      name: "kimi-auth",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: "Bearer secret-cookie",
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "X-Language": "en-US",
          "X-Msh-Platform": "web",
        },
        body: JSON.stringify({ scope: ["FEATURE_CODING"] }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-cookie");
  });

  test("uses the current page access token when the legacy cookie is absent", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("page-token");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(fixture()),
    );

    const result = await kimiAdapter.collect(
      context(fetch, vi.fn().mockResolvedValue(null), getAccessToken),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { providerId: "kimi" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer page-token",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("page-token");
  });

  test.each([null, { value: "" }])(
    "asks for an open signed-in tab when no supported Kimi credential is available",
    async (cookie) => {
      const result = await kimiAdapter.collect(
        context(
          vi.fn<typeof globalThis.fetch>(),
          vi.fn().mockResolvedValue(cookie),
          vi.fn().mockResolvedValue(undefined),
        ),
      );

      expect(result).toEqual({
        ok: false,
        health: {
          kind: "temporary_error",
          message: "Open Kimi in a tab, make sure you're signed in, then try again.",
        },
      });
    },
  );

  test.each([401, 429, 500])("maps HTTP %i correctly", async (status) => {
    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({}, status)),
        vi.fn().mockResolvedValue({ value: "secret-cookie" }),
      ),
    );

    expect(result).toEqual({
      ok: false,
      health: { kind: status === 401 ? "signed_out" : "temporary_error" },
    });
  });

  test.each([
    fixture({
      usages: [{ ...codingUsage(), detail: { ...codingUsage().detail, limit: "not-a-number" } }],
    }),
    fixture({
      usages: [{ ...codingUsage(), detail: { ...codingUsage().detail, used: "1001" } }],
    }),
    fixture({
      usages: [
        {
          ...codingUsage(),
          limits: [
            {
              ...codingUsage().limits[0],
              window: { duration: 300, timeUnit: "TIME_UNIT_WEEK" },
            },
          ],
        },
      ],
    }),
  ])("rejects malformed or semantically invalid usage", async (body) => {
    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body)),
        vi.fn().mockResolvedValue({ value: "secret-cookie" }),
      ),
    );

    expect(result).toEqual({ ok: false, health: { kind: "provider_changed" } });
  });
});
