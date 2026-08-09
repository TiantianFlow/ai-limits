import { describe, expect, test, vi } from "vitest";

import { kimiAdapter } from "./adapter";

const NOW = 1_800_000_000_000;
const MONTHLY_RESET = "2030-02-01T00:00:00.000Z";
const MONTHLY_START = "2030-01-01T00:00:00.000Z";
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

function statsFixture(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionBalance: {
      amountUsedRatio: 0.019,
      kimiCodeUsedRatio: 0.0495,
      expireTime: MONTHLY_RESET,
    },
    ratelimitCode5h: {
      ratio: 0.2476,
      enabled: true,
      resetTime: FIVE_HOUR_RESET,
    },
    ratelimitCode7d: {
      ratio: 0.0495,
      enabled: true,
      resetTime: WEEKLY_RESET,
    },
    ...overrides,
  };
}

function subscriptionFixture(title = "Kimi Coding Ultra") {
  return {
    subscription: {
      active: true,
      status: "SUBSCRIPTION_STATUS_ACTIVE",
      type: "SUBSCRIPTION_TYPE_PAID",
      goods: {
        title,
        membershipLevel: "MEMBERSHIP_LEVEL_ULTRA",
      },
    },
  };
}

function context(
  fetch: typeof globalThis.fetch,
  getCookie = vi.fn(),
  findAvailableAccessToken = vi.fn(),
  recoverAccessToken = vi.fn(),
  interaction: "allowed" | "forbidden" = "allowed",
) {
  return {
    fetch,
    getCookie,
    interaction,
    kimiSessionResolver: {
      findAvailableAccessToken,
      recoverAccessToken,
    },
    now: NOW,
    signal: new AbortController().signal,
  };
}

describe("Kimi adapter", () => {
  test("normalizes current monthly, five-hour, and weekly usage stats", async () => {
    const getCookie = vi.fn().mockResolvedValue({ value: "secret-cookie" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(statsFixture()),
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
            id: "monthly-total",
            label: "Monthly total",
            kind: "calendar",
            usedRatio: 0.019,
            startedAt: Date.parse(MONTHLY_START),
            resetsAt: Date.parse(MONTHLY_RESET),
            sourceSemantics: "used",
          },
          {
            id: "five-hour-coding",
            label: "5-hour coding",
            kind: "feature",
            usedRatio: 0.2476,
            resetsAt: Date.parse(FIVE_HOUR_RESET),
            durationMs: 5 * 60 * 60 * 1_000,
            sourceSemantics: "used",
          },
          {
            id: "weekly-coding",
            label: "Weekly coding",
            kind: "feature",
            usedRatio: 0.0495,
            resetsAt: Date.parse(WEEKLY_RESET),
            durationMs: 7 * 24 * 60 * 60 * 1_000,
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
      "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats",
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
        body: JSON.stringify({}),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-cookie");
  });

  test("uses the previous calendar-month boundary for monthly pacing", async () => {
    const resetAt = "2030-03-31T16:11:00.000Z";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(
        statsFixture({
          subscriptionBalance: {
            amountUsedRatio: 0.03,
            expireTime: resetAt,
          },
        }),
      ),
    );

    const result = await kimiAdapter.collect(
      context(fetch, vi.fn().mockResolvedValue({ value: "secret-cookie" })),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(
        result.snapshot.windows.find((window) => window.id === "monthly-total"),
      ).toMatchObject({
        startedAt: Date.parse("2030-02-28T16:11:00.000Z"),
        resetsAt: Date.parse(resetAt),
      });
    }
  });

  test("adds the exact Kimi subscription title without retaining raw metadata", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(statsFixture()))
      .mockResolvedValueOnce(response(subscriptionFixture("Kimi Coding Ultra")));

    const result = await kimiAdapter.collect(
      context(fetch, vi.fn().mockResolvedValue({ value: "secret-cookie" })),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        providerId: "kimi",
        planLabel: "Kimi Coding Ultra",
      },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription",
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
    expect(JSON.stringify(result)).not.toContain("MEMBERSHIP_LEVEL_ULTRA");
  });

  test("keeps valid usage when optional subscription metadata changes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(statsFixture()))
      .mockResolvedValueOnce(response({ subscription: { goods: { title: 42 } } }));

    const result = await kimiAdapter.collect(
      context(fetch, vi.fn().mockResolvedValue({ value: "secret-cookie" })),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        providerId: "kimi",
        windows: expect.arrayContaining([
          expect.objectContaining({ id: "monthly-total" }),
        ]),
      },
    });
    if (result.ok) {
      expect(result.snapshot.planLabel).toBeUndefined();
    }
  });

  test("uses the current page access token when the legacy cookie is absent", async () => {
    const findAvailableAccessToken = vi.fn().mockResolvedValue("page-token");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(statsFixture()),
    );

    const result = await kimiAdapter.collect(
      context(fetch, vi.fn().mockResolvedValue(null), findAvailableAccessToken),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { providerId: "kimi" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer page-token",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("page-token");
  });

  test("defers a scheduled read with no token without attempting recovery", async () => {
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-page-token");

    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>(),
        vi.fn().mockResolvedValue(null),
        vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
        "forbidden",
      ),
    );

    expect(result).toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(recoverAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("Kimi was still starting");
  });

  test("defers a scheduled rejected token after one API call and an open-tab reread", async () => {
    const findAvailableAccessToken = vi
      .fn()
      .mockResolvedValue("stale-page-token");
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-page-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ providerError: "raw-secret-error" }, 401));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue(null),
        findAvailableAccessToken,
        recoverAccessToken,
        "forbidden",
      ),
    );

    expect(result).toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(findAvailableAccessToken).toHaveBeenCalledTimes(2);
    expect(recoverAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("stale-page-token");
    expect(JSON.stringify(result)).not.toContain("raw-secret-error");
  });

  test("manual no-token recovery accepts a newly available token", async () => {
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-page-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(statsFixture()))
      .mockResolvedValueOnce(response(subscriptionFixture()));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue(null),
        vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { providerId: "kimi", planLabel: "Kimi Coding Ultra" },
    });
    expect(recoverAccessToken).toHaveBeenCalledOnce();
    expect(recoverAccessToken).toHaveBeenCalledWith(undefined);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-page-token",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("fresh-page-token");
  });

  test("attempts interactive recovery only once when a recovered initial token is rejected", async () => {
    const recoverAccessToken = vi.fn().mockResolvedValue("recovered-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({}, 401));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue(null),
        vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
      ),
    );

    expect(result).toEqual({
      ok: false,
      health: {
        kind: "temporary_error",
        message:
          "Kimi was still starting. Try Refresh once more, or open or reload Kimi.",
      },
    });
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("rereads a changed page token once after the sampled token is rejected", async () => {
    const findAvailableAccessToken = vi
      .fn()
      .mockResolvedValueOnce("stale-page-token")
      .mockResolvedValueOnce("fresh-page-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(statsFixture()))
      .mockResolvedValueOnce(response(subscriptionFixture()));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue(null),
        findAvailableAccessToken,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { providerId: "kimi", planLabel: "Kimi Coding Ultra" },
    });
    expect(findAvailableAccessToken).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer stale-page-token",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-page-token",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("stale-page-token");
    expect(JSON.stringify(result)).not.toContain("fresh-page-token");
  });

  test("manual stale-token recovery calls the API first and retries it once", async () => {
    const findAvailableAccessToken = vi
      .fn()
      .mockResolvedValueOnce("stale-page-token")
      .mockResolvedValueOnce("stale-page-token");
    const recoverAccessToken = vi
      .fn()
      .mockResolvedValue("fresh-page-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(statsFixture()))
      .mockResolvedValueOnce(response(subscriptionFixture()));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue(null),
        findAvailableAccessToken,
        recoverAccessToken,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { providerId: "kimi", planLabel: "Kimi Coding Ultra" },
    });
    expect(recoverAccessToken).toHaveBeenCalledOnce();
    expect(recoverAccessToken).toHaveBeenCalledWith("stale-page-token");
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-page-token",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("stale-page-token");
    expect(JSON.stringify(result)).not.toContain("fresh-page-token");
  });

  test("gives a manual fallback when explicit recovery finds no token", async () => {
    const recoverAccessToken = vi.fn().mockResolvedValue(undefined);

    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({}, 401)),
        vi.fn().mockResolvedValue(null),
        vi.fn().mockResolvedValue("stale-page-token"),
        recoverAccessToken,
      ),
    );

    expect(result).toEqual({
      ok: false,
      health: {
        kind: "temporary_error",
        message:
          "Kimi was still starting. Try Refresh once more, or open or reload Kimi.",
      },
    });
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
  });

  test("does not open a temporary tab when optional subscription metadata is unauthorized", async () => {
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-page-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(statsFixture()))
      .mockResolvedValueOnce(response({}, 401));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue({ value: "valid-cookie" }),
        vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        providerId: "kimi",
        windows: expect.arrayContaining([
          expect.objectContaining({ id: "monthly-total" }),
        ]),
      },
    });
    expect(recoverAccessToken).not.toHaveBeenCalled();
  });

  test("retries once with the current page token when a stale cookie is rejected", async () => {
    const findAvailableAccessToken = vi.fn().mockResolvedValue("page-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(statsFixture()));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue({ value: "stale-cookie" }),
        findAvailableAccessToken,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { providerId: "kimi", windows: expect.any(Array) },
    });
    expect(findAvailableAccessToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer stale-cookie" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer page-token" }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("stale-cookie");
    expect(JSON.stringify(result)).not.toContain("page-token");
  });

  test("falls back to the legacy coding endpoint when current stats are unavailable", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(fixture()));

    const result = await kimiAdapter.collect(
      context(fetch, vi.fn().mockResolvedValue({ value: "secret-cookie" })),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          expect.objectContaining({ id: "weekly-coding", usedRatio: 0.25 }),
          expect.objectContaining({ id: "five-hour-coding", usedRatio: 0.25 }),
        ],
      },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages",
      expect.objectContaining({
        body: JSON.stringify({ scope: ["FEATURE_CODING"] }),
      }),
    );
  });

  test("defers a scheduled legacy-endpoint 401 after a passive page-token reread", async () => {
    const findAvailableAccessToken = vi
      .fn()
      .mockResolvedValue("stale-cookie");
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ raw: "secret-error" }, 401));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue({ value: "stale-cookie" }),
        findAvailableAccessToken,
        recoverAccessToken,
        "forbidden",
      ),
    );

    expect(result).toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(findAvailableAccessToken).toHaveBeenCalledOnce();
    expect(recoverAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret-error");
    expect(JSON.stringify(result)).not.toContain("Kimi was still starting");
  });

  test("recovers a manual legacy-endpoint 401 and retries that endpoint once", async () => {
    const findAvailableAccessToken = vi
      .fn()
      .mockResolvedValue("stale-cookie");
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 405))
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(fixture()));

    const result = await kimiAdapter.collect(
      context(
        fetch,
        vi.fn().mockResolvedValue({ value: "stale-cookie" }),
        findAvailableAccessToken,
        recoverAccessToken,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        providerId: "kimi",
        windows: expect.arrayContaining([
          expect.objectContaining({ id: "weekly-coding" }),
        ]),
      },
    });
    expect(findAvailableAccessToken).toHaveBeenCalledOnce();
    expect(recoverAccessToken).toHaveBeenCalledOnce();
    expect(recoverAccessToken).toHaveBeenCalledWith("stale-cookie");
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-token",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("fresh-token");
  });

  test("keeps valid current windows when another stats section changes", async () => {
    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          response(
            statsFixture({
              ratelimitCode5h: { ratio: "24.76%", resetTime: FIVE_HOUR_RESET },
            }),
          ),
        ),
        vi.fn().mockResolvedValue({ value: "secret-cookie" }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          { id: "monthly-total" },
          { id: "weekly-coding" },
        ],
      },
    });
  });

  test("sanitizes resolver errors from a failed explicit recovery", async () => {
    const rawError = "raw-secret-resolver-error";
    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>(),
        vi.fn().mockResolvedValue(null),
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockRejectedValue(new Error(rawError)),
      ),
    );

    expect(result).toEqual({
      ok: false,
      health: {
        kind: "temporary_error",
        message:
          "Kimi was still starting. Try Refresh once more, or open or reload Kimi.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawError);
  });

  test.each([401, 429, 500])("maps HTTP %i correctly", async (status) => {
    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({}, status)),
        vi.fn().mockResolvedValue({ value: "secret-cookie" }),
      ),
    );

    expect(result).toEqual(
      status === 401
        ? {
            ok: false,
            health: {
              kind: "temporary_error",
              message:
                "Kimi was still starting. Try Refresh once more, or open or reload Kimi.",
            },
          }
        : { ok: false, health: { kind: "temporary_error" } },
    );
  });

  test.each([
    statsFixture({
      subscriptionBalance: { amountUsedRatio: 1.1, expireTime: MONTHLY_RESET },
      ratelimitCode5h: null,
      ratelimitCode7d: null,
    }),
    statsFixture({
      subscriptionBalance: null,
      ratelimitCode5h: { ratio: "0.25", enabled: true, resetTime: FIVE_HOUR_RESET },
      ratelimitCode7d: null,
    }),
    statsFixture({
      subscriptionBalance: null,
      ratelimitCode5h: null,
      ratelimitCode7d: { ratio: 0.25, enabled: true, resetTime: "not-a-date" },
    }),
  ])("rejects current responses with no valid usage window", async (body) => {
    const result = await kimiAdapter.collect(
      context(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body)),
        vi.fn().mockResolvedValue({ value: "secret-cookie" }),
      ),
    );

    expect(result).toEqual({ ok: false, health: { kind: "provider_changed" } });
  });
});
