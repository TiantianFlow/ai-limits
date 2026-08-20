import { describe, expect, test, vi } from "vitest";

import { GROK_RATE_LIMIT_MODEL_NAMES, grokAdapter } from "./adapter";
import {
  PRODUCT_GROK_BUILD,
  PRODUCT_GROK_CHAT,
  USAGE_PERIOD_WEEKLY,
  encodeGrokCreditsConfigResponse,
} from "./credits-config";
import {
  EMPTY_GRPC_WEB_UNARY,
  GRPC_WEB_CONTENT_TYPE,
  concatenateFrames,
  encodeGrpcWebDataFrame,
  encodeGrpcWebTrailerFrame,
} from "./grpc-web";

const NOW = 1_800_000_000_000;
// Observed GET /api/auth/session envelope. Identity is nested under
// session.userId; email/sessionId were captured empty on a guest.
const GUEST_SESSION = {
  status: "authenticated",
  session: { userId: "", email: "", sessionId: "" },
} as const;
const SIGNED_IN_SESSION = {
  status: "authenticated",
  session: { userId: "user-test" },
} as const;
const RATE_LIMIT_MODES = ["fast", "expert", "heavy", "auto"] as const;
const POOL_NOT_FOUND =
  "Grok usage-pool route not found. GetGrokCreditsConfig HTTP 404 content-type=application/json";
// Shape captured from a live SuperGrok Heavy account; values below are synthetic.
const SYNTHETIC_PERIOD_END = Date.parse("2030-06-15T12:00:00.000Z");

// Captured signed-in POST /rest/rate-limits {"modelName":"fast"} body.
// Extra null effort fields are present on the wire and must be tolerated.
function usageFixture(overrides: Record<string, unknown> = {}) {
  return {
    windowSizeSeconds: 7_200,
    remainingQueries: 2,
    totalQueries: 2,
    lowEffortRateLimits: null,
    highEffortRateLimits: null,
    ...overrides,
  };
}

function response(
  body: unknown,
  status = 200,
  contentType = "application/json",
): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    {
      status,
      headers: { "content-type": contentType },
    },
  );
}

function grpcWebResponse(
  payload: Uint8Array,
  grpcStatus = 0,
  httpStatus = 200,
): Response {
  const body = concatenateFrames(
    encodeGrpcWebDataFrame(payload),
    encodeGrpcWebTrailerFrame(grpcStatus),
  );
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return new Response(copy, {
    status: httpStatus,
    headers: { "content-type": GRPC_WEB_CONTENT_TYPE },
  });
}

function weeklyPoolResponse() {
  return grpcWebResponse(
    encodeGrokCreditsConfigResponse({
      creditUsagePercent: 12,
      isUnifiedBillingUser: true,
      currentPeriodType: USAGE_PERIOD_WEEKLY,
      currentPeriodEndMs: SYNTHETIC_PERIOD_END,
      prepaidBalanceCents: 0,
      productUsage: [
        { product: PRODUCT_GROK_BUILD, usagePercent: 8 },
        { product: PRODUCT_GROK_CHAT, usagePercent: 4 },
      ],
    }),
  );
}

function context(
  fetch: typeof globalThis.fetch,
  signal = new AbortController().signal,
) {
  return { fetch, now: NOW, signal };
}

function queryMetric(mode: string) {
  return {
    type: "quota" as const,
    id: `2-hour-${mode}-queries`,
    label: `2-hour ${mode} queries`,
    scope: "general" as const,
    usedRatio: 0,
    used: 0,
    limit: 2,
    unit: "queries",
    cycle: {
      cadence: "rolling" as const,
      durationMs: 7_200_000,
    },
  };
}

function signedInFetch(
  usage: unknown | ((mode: string) => unknown) = usageFixture(),
  subscriptions: unknown = { subscriptions: [] },
  options: {
    usageStatus?: number | ((mode: string) => number);
    subscriptionsStatus?: number;
    pool?: Response;
  } = {},
) {
  return vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const href = String(url);
    if (href.includes("/api/auth/session")) {
      return response(SIGNED_IN_SESSION);
    }
    if (href.includes("GetGrokCreditsConfig")) {
      return options.pool ?? response({}, 404);
    }
    if (href.includes("/rest/rate-limits")) {
      const mode = JSON.parse(String(init?.body ?? "{}")).modelName as string;
      const body = typeof usage === "function" ? usage(mode) : usage;
      const status =
        typeof options.usageStatus === "function"
          ? options.usageStatus(mode)
          : (options.usageStatus ?? (body === undefined ? 404 : 200));
      if (body === undefined) {
        return response({ code: 5, message: "Model not found." }, status);
      }
      return response(body, status);
    }
    if (href.includes("/rest/subscriptions")) {
      return response(subscriptions, options.subscriptionsStatus ?? 200);
    }
    return response({}, 404);
  });
}

function rateLimitBodies(fetchMock: ReturnType<typeof signedInFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/rest/rate-limits"))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("Grok adapter", () => {
  test("fans out rate-limits across chat modes without persisting the raw response", async () => {
    const injectedFetch = signedInFetch(usageFixture());

    const result = await grokAdapter.collect(context(injectedFetch));

    expect(GROK_RATE_LIMIT_MODEL_NAMES).toEqual(RATE_LIMIT_MODES);
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "grok",
        planLabel: "Free",
        source: "web-session",
        fetchedAt: NOW,
        metrics: RATE_LIMIT_MODES.map((mode) => queryMetric(mode)),
        usageGroups: [
          {
            id: "rate-limits",
            label: "Chat rate limits",
            description: POOL_NOT_FOUND,
            metricIds: RATE_LIMIT_MODES.map((mode) => `2-hour-${mode}-queries`),
          },
        ],
      },
    });
    expect(injectedFetch).toHaveBeenNthCalledWith(
      1,
      "https://grok.com/api/auth/session",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(rateLimitBodies(injectedFetch)).toEqual(
      RATE_LIMIT_MODES.map((modelName) => ({ modelName })),
    );
    expect(injectedFetch).toHaveBeenCalledTimes(7);
    expect(injectedFetch).toHaveBeenCalledWith(
      "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: EMPTY_GRPC_WEB_UNARY,
        headers: expect.objectContaining({
          "Content-Type": GRPC_WEB_CONTENT_TYPE,
        }),
      }),
    );
    expect(injectedFetch.mock.calls.some(([calledUrl]) =>
      String(calledUrl).includes("/rest/grok/credits"),
    )).toBe(false);
    expect(JSON.stringify(result)).not.toContain("authenticated");
    expect(JSON.stringify(result)).not.toContain("user-test");
    expect(JSON.stringify(result)).not.toContain("windowSizeSeconds");
    expect(JSON.stringify(result)).not.toContain("lowEffortRateLimits");
  });

  test("emits queries and tokens when both remaining and total token fields are consistent", async () => {
    const injectedFetch = signedInFetch(
      usageFixture({
        remainingTokens: 8_000,
        totalTokens: 10_000,
      }),
    );

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: RATE_LIMIT_MODES.flatMap((mode) => [
          expect.objectContaining({
            type: "quota",
            id: `2-hour-${mode}-queries`,
            used: 0,
            limit: 2,
          }),
          expect.objectContaining({
            type: "quota",
            id: `2-hour-${mode}-tokens`,
            label: `2-hour ${mode} tokens`,
            usedRatio: 0.2,
            used: 2_000,
            limit: 10_000,
            unit: "tokens",
          }),
        ]),
        usageGroups: [
          {
            id: "rate-limits",
            label: "Chat rate limits",
            metricIds: RATE_LIMIT_MODES.flatMap((mode) => [
              `2-hour-${mode}-queries`,
              `2-hour-${mode}-tokens`,
            ]),
          },
        ],
      },
    });
  });

  test("keeps a successful mode when another mode 404s", async () => {
    const injectedFetch = signedInFetch((mode: string) =>
      mode === "fast" ? usageFixture() : undefined,
    );

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [expect.objectContaining({ id: "2-hour-fast-queries" })],
        usageGroups: [
          {
            id: "rate-limits",
            label: "Chat rate limits",
            metricIds: ["2-hour-fast-queries"],
          },
        ],
      },
    });
    if (result.ok) {
      expect(result.snapshot.metrics).toHaveLength(1);
    }
    expect(rateLimitBodies(injectedFetch)).toHaveLength(4);
  });

  test("rejects a contradictory remaining > total payload on every mode", async () => {
    const injectedFetch = signedInFetch(
      usageFixture({ remainingQueries: 120, totalQueries: 100 }),
    );

    await expect(grokAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: {
        kind: "provider_changed",
        message:
          "fast: Grok rate-limits response has contradictory query counts.",
      },
    });
  });

  test("tolerates unknown extra fields on a valid queries payload", async () => {
    const injectedFetch = signedInFetch(
      usageFixture({
        unexpectedVendorField: { nested: true },
        preGenerationDelayMs: 250,
      }),
    );

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({ id: "2-hour-fast-queries", used: 0 }),
        ]),
      },
    });
    if (result.ok) {
      expect(result.snapshot.metrics).toHaveLength(4);
    }
  });

  test("keeps valid queries when the optional tokens block is malformed", async () => {
    const injectedFetch = signedInFetch(
      usageFixture({
        remainingTokens: "8000",
        totalTokens: 10_000,
      }),
    );

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({ id: "2-hour-fast-queries" }),
        ]),
      },
    });
    if (result.ok) {
      expect(result.snapshot.metrics).toHaveLength(4);
      expect(
        result.snapshot.metrics.every((metric) => metric.unit === "queries"),
      ).toBe(true);
    }
  });

  test("maps a session status of unauthenticated to signed out", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ status: "unauthenticated" }));

    await expect(grokAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "signed_out" },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(1);
  });

  test("maps a guest authenticated session with an empty nested userId to signed out", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(GUEST_SESSION));

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toEqual({
      ok: false,
      health: { kind: "signed_out" },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("user-test");
  });

  test("reaches rate-limits when the observed nested session.userId is present", async () => {
    const injectedFetch = signedInFetch(usageFixture());

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({ ok: true });
    expect(injectedFetch).toHaveBeenNthCalledWith(
      2,
      "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
      expect.objectContaining({ method: "POST" }),
    );
    expect(injectedFetch).toHaveBeenNthCalledWith(
      3,
      "https://grok.com/rest/rate-limits",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ modelName: "fast" }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("user-test");
  });

  test("maps all-mode 404 Model not found responses to a distinct provider_changed detail", async () => {
    const injectedFetch = signedInFetch(() => undefined);

    await expect(grokAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: {
        kind: "provider_changed",
        message:
          "fast: Grok rate-limits HTTP 404. code=5 message=Model not found.",
      },
    });
    expect(rateLimitBodies(injectedFetch)).toHaveLength(4);
  });

  test("reports which required rate-limits field is missing on HTTP 200", async () => {
    const injectedFetch = signedInFetch({
      windowSizeSeconds: 7_200,
      totalQueries: 2,
    });

    await expect(grokAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: {
        kind: "provider_changed",
        message:
          "fast: Grok rate-limits response missing required field: remainingQueries",
      },
    });
  });

  test("maps HTTP 401 no-credentials to signed out without finishing the fan-out", async () => {
    const injectedFetch = signedInFetch(usageFixture(), { subscriptions: [] }, {
      usageStatus: 401,
    });

    await expect(grokAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "signed_out" },
    });
    expect(rateLimitBodies(injectedFetch)).toEqual([{ modelName: "fast" }]);
  });

  test("returns usage when subscriptions fail", async () => {
    const injectedFetch = signedInFetch(usageFixture(), {}, {
      subscriptionsStatus: 500,
    });

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({ id: "2-hour-fast-queries" }),
        ]),
      },
    });
    if (result.ok) {
      expect(result.snapshot.planLabel).toBeUndefined();
      expect(result.snapshot.metrics).toHaveLength(4);
    }
  });

  test("maps the highest active SuperGrok-family tier and omits an unmapped tier", async () => {
    const heavy = signedInFetch(usageFixture(), {
      subscriptions: [
        {
          tier: "SUBSCRIPTION_TIER_SUPER_GROK_LITE",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
        },
        {
          tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
        },
      ],
    });
    await expect(grokAdapter.collect(context(heavy))).resolves.toMatchObject({
      ok: true,
      snapshot: { planLabel: "SuperGrok Heavy" },
    });

    const unmapped = signedInFetch(usageFixture(), {
      subscriptions: [
        {
          tier: "SUBSCRIPTION_TIER_FUTURE",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
        },
      ],
    });
    const unmappedResult = await grokAdapter.collect(context(unmapped));
    expect(unmappedResult).toMatchObject({ ok: true });
    if (unmappedResult.ok) {
      expect(unmappedResult.snapshot.planLabel).toBeUndefined();
    }
  });

  test("labels X Premium as Free rather than a Grok plan", async () => {
    const injectedFetch = signedInFetch(usageFixture(), {
      subscriptions: [
        {
          tier: "SUBSCRIPTION_TIER_X_PREMIUM_PLUS",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
        },
      ],
    });

    await expect(
      grokAdapter.collect(context(injectedFetch)),
    ).resolves.toMatchObject({
      ok: true,
      snapshot: { planLabel: "Free" },
    });
  });

  test("derives weekly and day window ids from the reported duration", async () => {
    const weekly = signedInFetch(
      usageFixture({
        windowSizeSeconds: 604_800,
        waitTimeSeconds: undefined,
      }),
    );
    await expect(grokAdapter.collect(context(weekly))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({ id: "weekly-fast-queries" }),
        ]),
      },
    });

    const threeDay = signedInFetch(
      usageFixture({
        windowSizeSeconds: 259_200,
        waitTimeSeconds: undefined,
      }),
    );
    await expect(grokAdapter.collect(context(threeDay))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: expect.arrayContaining([
          expect.objectContaining({
            id: "3-day-fast-queries",
            label: "3-day fast queries",
          }),
        ]),
      },
    });
  });

  test("omits resetsAt when waitTimeSeconds is absent or non-finite", async () => {
    const injectedFetch = signedInFetch(
      usageFixture({ waitTimeSeconds: "3600" }),
    );

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.metrics[0]).toMatchObject({
        id: "2-hour-fast-queries",
        cycle: { cadence: "rolling", durationMs: 7_200_000 },
      });
      expect(result.snapshot.metrics[0]?.cycle).not.toHaveProperty("resetsAt");
    }
  });

  test.each([429, 500, 503])(
    "maps HTTP %i on every mode to a temporary error",
    async (status) => {
      const injectedFetch = signedInFetch(usageFixture(), { subscriptions: [] }, {
        usageStatus: status,
      });

      await expect(grokAdapter.collect(context(injectedFetch))).resolves.toEqual({
        ok: false,
        health: {
          kind: "temporary_error",
          message: `fast: Grok rate-limits HTTP ${status}.`,
        },
      });
    },
  );

  test("renders only the weekly pool and skips rate-limits when the pool maps", async () => {
    const injectedFetch = signedInFetch(usageFixture(), { subscriptions: [] }, {
      pool: weeklyPoolResponse(),
    });

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.metrics).toEqual([
        expect.objectContaining({
          id: "weekly-pool",
          label: "Weekly usage pool",
          usedRatio: 0.12,
          cycle: { cadence: "calendar", resetsAt: SYNTHETIC_PERIOD_END },
        }),
        expect.objectContaining({
          id: "extra-usage-credits",
          type: "balance",
          value: 0,
          unit: "USD",
        }),
      ]);
      expect(result.snapshot.metrics[0]?.cycle).not.toHaveProperty("durationMs");
      expect(result.snapshot.usageGroups).toEqual([
        {
          id: "usage-pool",
          label: "Usage pool",
          metricIds: ["weekly-pool", "extra-usage-credits"],
        },
      ]);
      expect(result.snapshot.metrics[0]).not.toHaveProperty("used");
      expect(result.snapshot.metrics[0]).not.toHaveProperty("limit");
    }
    expect(rateLimitBodies(injectedFetch)).toEqual([]);
    expect(injectedFetch).toHaveBeenCalledTimes(3);
    expect(injectedFetch.mock.calls.some(([url]) =>
      String(url).includes("/rest/grok/credits"),
    )).toBe(false);
  });

  test("records a disabled-flag diagnostic without inventing a pool metric", async () => {
    const disabled = signedInFetch(usageFixture(), { subscriptions: [] }, {
      pool: grpcWebResponse(
        encodeGrokCreditsConfigResponse({ isUnifiedBillingUser: false }),
      ),
    });
    const disabledResult = await grokAdapter.collect(context(disabled));
    expect(disabledResult).toMatchObject({ ok: true });
    if (disabledResult.ok) {
      expect(disabledResult.snapshot.metrics.map((metric) => metric.id)).toEqual(
        RATE_LIMIT_MODES.map((mode) => `2-hour-${mode}-queries`),
      );
      expect(disabledResult.snapshot.usageGroups?.[0]?.description).toMatch(
        /^Grok usage-pool disabled: is_unified_billing_user is false\./,
      );
    }
  });

  test("does not coerce a missing billing flag to false", async () => {
    const injectedFetch = signedInFetch(usageFixture(), { subscriptions: [] }, {
      pool: grpcWebResponse(encodeGrokCreditsConfigResponse({})),
    });
    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.metrics[0]?.id).toBe("2-hour-fast-queries");
      expect(result.snapshot.usageGroups?.[0]?.description).toMatch(
        /^Grok usage-pool is missing is_unified_billing_user\./,
      );
    }
  });

  test("makes a pool 404 loud instead of silent", async () => {
    const missing = signedInFetch(usageFixture());
    const missingResult = await grokAdapter.collect(context(missing));
    expect(missingResult).toMatchObject({
      ok: true,
      snapshot: {
        usageGroups: [expect.objectContaining({ description: POOL_NOT_FOUND })],
      },
    });
    if (missingResult.ok) {
      expect(missingResult.snapshot.metrics[0]?.id).toBe("2-hour-fast-queries");
    }
  });

  test("records a non-zero grpc-status as a loud failure", async () => {
    const injectedFetch = signedInFetch(usageFixture(), { subscriptions: [] }, {
      pool: grpcWebResponse(new Uint8Array(), 5),
    });

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        usageGroups: [
          expect.objectContaining({
            description: expect.stringMatching(
              /^Grok usage-pool grpc-status=5\./,
            ),
          }),
        ],
      },
    });
    if (result.ok) {
      expect(result.snapshot.metrics[0]?.id).toBe("2-hour-fast-queries");
    }
  });

  test("fails loud when current_period.end is missing", async () => {
    const injectedFetch = signedInFetch(usageFixture(), { subscriptions: [] }, {
      pool: grpcWebResponse(
        encodeGrokCreditsConfigResponse({
          creditUsagePercent: 42,
          isUnifiedBillingUser: true,
          currentPeriodType: USAGE_PERIOD_WEEKLY,
        }),
      ),
    });

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.snapshot.usageGroups?.[0]?.description).toMatch(
        /^Grok usage-pool missing required field: current_period.end/,
      );
      expect(result.snapshot.metrics[0]?.id).toBe("2-hour-fast-queries");
    }
  });

  test("does not fan out rate-limits when the pool is available", async () => {
    const injectedFetch = signedInFetch(() => undefined, { subscriptions: [] }, {
      pool: weeklyPoolResponse(),
    });

    const result = await grokAdapter.collect(context(injectedFetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          expect.objectContaining({ id: "weekly-pool" }),
          expect.objectContaining({ id: "extra-usage-credits", value: 0 }),
        ],
      },
    });
    if (result.ok) {
      expect(result.snapshot.metrics).toHaveLength(2);
    }
    expect(rateLimitBodies(injectedFetch)).toEqual([]);
  });

  test("maps an aborted request to a temporary error", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Timed out", "AbortError"));
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(controller.signal.reason);

    await expect(
      grokAdapter.collect(context(injectedFetch, controller.signal)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
