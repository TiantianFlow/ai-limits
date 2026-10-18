import { describe, expect, test, vi } from "vitest";

import {
  observationFromUsage,
  quotaHistorySeries,
} from "../../domain/history";
import type { CollectionContext } from "../types";
import { factoryAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-factory-key";
const USER_ID = "user-synthetic-id-should-not-persist";
const BILLING_URL = "https://api.factory.ai/api/billing/limits";
const AUTH_URL = "https://api.factory.ai/api/app/auth/me";
const USAGE_URL =
  "https://api.factory.ai/api/organization/subscription/usage?useCache=true";
const USAGE_URL_WITH_USER = `${USAGE_URL}&userId=${USER_ID}`;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

function response(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function context(
  fetch: typeof globalThis.fetch,
  overrides: Partial<CollectionContext> = {},
): CollectionContext {
  return {
    fetch,
    now: NOW,
    signal: new AbortController().signal,
    credential: { kind: "api-key", value: ` ${TEST_CREDENTIAL} ` },
    ...overrides,
  };
}

function headers(): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${TEST_CREDENTIAL}`,
    "x-factory-client": "web-app",
  };
}

function window(
  usedPercent: number,
  extras: Record<string, unknown> = {},
) {
  return { usedPercent, ...extras };
}

function billingFixture(overrides: Record<string, unknown> = {}) {
  return {
    usesTokenRateLimitsBilling: true,
    limits: {
      standard: {
        fiveHour: window(12, { secondsRemaining: 3600 }),
        weekly: window(34, { secondsRemaining: 86_400 }),
        monthly: window(56, { secondsRemaining: 604_800 }),
      },
      core: {
        fiveHour: window(0),
        weekly: window(0),
        monthly: window(0),
      },
    },
    extraUsageBalanceCents: 1_050,
    extraUsageAllowed: true,
    ...overrides,
  };
}

function authFixture(overrides: Record<string, unknown> = {}) {
  return {
    userProfile: { id: USER_ID },
    organization: {
      subscription: {
        factoryTier: "droid",
        orbSubscription: { plan: { name: "Pro" } },
      },
    },
    ...overrides,
  };
}

function routeFetch(
  routes: Record<string, Response | (() => Promise<Response>)>,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected url ${url}`);
    void init;
    return typeof route === "function" ? route() : route;
  });
}

describe("Droid adapter", () => {
  test("reads token-rate-limit windows, active Core pools, extra usage, and the plan", async () => {
    const controller = new AbortController();
    const fetch = routeFetch({
      [BILLING_URL]: response(
        billingFixture({
          limits: {
            standard: {
              fiveHour: window(12, { secondsRemaining: 3600, windowEnd: "1999-01-01T00:00:00.000Z" }),
              weekly: window(34, { secondsRemaining: 86_400 }),
              monthly: window(56, { windowEnd: NOW + WEEK_MS }),
            },
            core: {
              fiveHour: window(0),
              weekly: window(8, { secondsRemaining: 3_600 }),
              monthly: window(0),
            },
          },
        }),
      ),
      [AUTH_URL]: response(authFixture()),
    });

    const result = await factoryAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenNthCalledWith(1, BILLING_URL, {
      method: "GET",
      headers: headers(),
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenNthCalledWith(2, AUTH_URL, {
      method: "GET",
      headers: headers(),
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "factory",
        planLabel: "Pro",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "standard-five-hour",
            label: "5-hour",
            scope: "general",
            usedRatio: 0.12,
            cycle: {
              cadence: "rolling",
              resetsAt: NOW + 3_600_000,
              durationMs: FIVE_HOURS_MS,
            },
          },
          {
            type: "quota",
            id: "standard-weekly",
            label: "Weekly",
            scope: "general",
            usedRatio: 0.34,
            cycle: {
              cadence: "rolling",
              resetsAt: NOW + 86_400_000,
              durationMs: WEEK_MS,
            },
          },
          {
            type: "quota",
            id: "standard-monthly",
            label: "Monthly",
            scope: "general",
            usedRatio: 0.56,
            cycle: { cadence: "rolling", resetsAt: NOW + WEEK_MS },
          },
          {
            type: "quota",
            id: "core-five-hour",
            label: "Core 5-hour",
            scope: "product",
            usedRatio: 0,
            cycle: { cadence: "rolling" },
          },
          {
            type: "quota",
            id: "core-weekly",
            label: "Core weekly",
            scope: "product",
            usedRatio: 0.08,
            cycle: {
              cadence: "rolling",
              resetsAt: NOW + 3_600_000,
              durationMs: WEEK_MS,
            },
          },
          {
            type: "quota",
            id: "core-monthly",
            label: "Core monthly",
            scope: "product",
            usedRatio: 0,
            cycle: { cadence: "rolling" },
          },
          {
            type: "balance",
            id: "extra-usage",
            label: "Extra usage",
            scope: "product",
            value: 10.5,
            unit: "USD",
          },
        ],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: [
              "standard-five-hour",
              "standard-weekly",
              "standard-monthly",
            ],
          },
          {
            id: "droid-core",
            label: "Droid Core",
            metricIds: ["core-five-hour", "core-weekly", "core-monthly"],
          },
          { id: "credits", label: "Credits", metricIds: ["extra-usage"] },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(USER_ID);
    if (!result.ok) return;
    const observation = observationFromUsage(result.snapshot);
    expect(
      quotaHistorySeries([observation], "standard-five-hour").segments,
    ).toEqual([
      {
        points: [
          expect.objectContaining({
            observedAt: NOW,
            usedRatio: 0.12,
          }),
        ],
      },
    ]);
    expect(quotaHistorySeries([observation], "extra-usage").segments).toEqual(
      [],
    );
    expect(observation.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "balance", metricId: "extra-usage" }),
      ]),
    );
  });

  test("omits an empty Core pool and a zero extra-usage balance that is not allowed", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response(
        billingFixture({
          extraUsageBalanceCents: 0,
          extraUsageAllowed: false,
        }),
      ),
      [AUTH_URL]: response({}, 500),
    });

    const result = await factoryAdapter.collect(context(fetch));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.planLabel).toBeUndefined();
    expect(result.snapshot.metrics.map((metric) => metric.id)).toEqual([
      "standard-five-hour",
      "standard-weekly",
      "standard-monthly",
    ]);
    expect(result.snapshot.metrics[2]?.cycle).not.toHaveProperty("durationMs");
  });

  test("keeps a zero extra-usage balance when extra usage is allowed", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response(
        billingFixture({
          extraUsageBalanceCents: 0,
          extraUsageAllowed: true,
          limits: {
            standard: billingFixture().limits.standard,
          },
        }),
      ),
      [AUTH_URL]: response(authFixture()),
    });

    const result = await factoryAdapter.collect(context(fetch));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.metrics.at(-1)).toMatchObject({
      type: "balance",
      id: "extra-usage",
      value: 0,
      unit: "USD",
    });
  });

  test("falls through to legacy subscription usage and does not persist the account id", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response({ usesTokenRateLimitsBilling: false }),
      [AUTH_URL]: response(
        authFixture({
          organization: {
            subscription: { factoryTier: "Plus", orbSubscription: { plan: { name: "Factory" } } },
          },
        }),
      ),
      [USAGE_URL_WITH_USER]: response({
        usage: {
          startDate: NOW - WEEK_MS,
          endDate: NOW + WEEK_MS,
          standard: { usedRatio: 0, userTokens: 100, totalAllowance: 1_000 },
          premium: { usedRatio: 40, userTokens: 0, totalAllowance: 500 },
        },
      }),
    });

    const result = await factoryAdapter.collect(context(fetch));

    expect(fetch).toHaveBeenNthCalledWith(
      3,
      USAGE_URL_WITH_USER,
      expect.objectContaining({ method: "GET", headers: headers() }),
    );
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "factory",
        planLabel: "Plus",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "standard-monthly",
            label: "Monthly",
            scope: "general",
            usedRatio: 0.1,
            used: 100,
            limit: 1_000,
            cycle: {
              cadence: "rolling",
              startedAt: NOW - WEEK_MS,
              resetsAt: NOW + WEEK_MS,
              durationMs: 2 * WEEK_MS,
            },
          },
          {
            type: "quota",
            id: "premium-monthly",
            label: "Premium",
            scope: "product",
            usedRatio: 0.4,
            cycle: {
              cadence: "rolling",
              startedAt: NOW - WEEK_MS,
              resetsAt: NOW + WEEK_MS,
              durationMs: 2 * WEEK_MS,
            },
          },
        ],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            metricIds: ["standard-monthly", "premium-monthly"],
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });

  test("uses top-level windows when nested usage is empty and omits an unproven window length", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response({}, 404),
      [AUTH_URL]: response({ user: { id: USER_ID } }),
      [USAGE_URL_WITH_USER]: response({
        usage: {},
        endDate: (NOW + WEEK_MS) / 1_000,
        standard: { used: 2, allowance: 8 },
      }),
    });

    const result = await factoryAdapter.collect(context(fetch));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.metrics).toEqual([
      {
        type: "quota",
        id: "standard-monthly",
        label: "Monthly",
        scope: "general",
        usedRatio: 0.25,
        used: 2,
        limit: 8,
        cycle: { cadence: "rolling", resetsAt: NOW + WEEK_MS },
      },
    ]);
  });

  test("reports an invalid key from auth without calling usage", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response({ detail: "no" }, 401),
      [AUTH_URL]: response({ detail: "no" }, 403),
    });

    await expect(factoryAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("returns retry timing when legacy usage is rate limited", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response({ detail: "later" }, 503),
      [AUTH_URL]: response(authFixture()),
      [USAGE_URL_WITH_USER]: response({ detail: "later" }, 429, {
        "Retry-After": "30",
      }),
    });

    await expect(factoryAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 30_000 },
    });
  });

  test("rejects a response that has neither rate limits nor a usable legacy pool", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response({ usesTokenRateLimitsBilling: true }),
      [AUTH_URL]: response(authFixture()),
      [USAGE_URL_WITH_USER]: response({ usage: { standard: {}, premium: {} } }),
    });

    await expect(factoryAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("reports a missing key and a network failure without a partial snapshot", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("offline");
    });

    await expect(
      factoryAdapter.collect(context(fetch, { credential: undefined })),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();

    await expect(factoryAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("keeps rate limits when the plan request cannot be read", async () => {
    const fetch = routeFetch({
      [BILLING_URL]: response(billingFixture({ extraUsageBalanceCents: -1 })),
      [AUTH_URL]: response("not-json", 200),
    });
    const notJson = routeFetch({
      [BILLING_URL]: response(billingFixture()),
      [AUTH_URL]: new Response("nope", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    });

    const negativeCents = await factoryAdapter.collect(context(fetch));
    const unreadablePlan = await factoryAdapter.collect(context(notJson));

    expect(negativeCents.ok).toBe(true);
    expect(unreadablePlan.ok).toBe(true);
    if (!negativeCents.ok || !unreadablePlan.ok) return;
    expect(
      negativeCents.snapshot.metrics.some((metric) => metric.id === "extra-usage"),
    ).toBe(false);
    expect(unreadablePlan.snapshot.planLabel).toBeUndefined();
    expect(unreadablePlan.snapshot.metrics[0]).toMatchObject({
      id: "standard-five-hour",
      usedRatio: 0.12,
    });
  });
});
