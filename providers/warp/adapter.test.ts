import { describe, expect, test, vi } from "vitest";

import {
  observationFromUsage,
  quotaHistorySeries,
} from "../../domain/history";
import type { CollectionContext } from "../types";
import { warpAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "wk-synthetic-warp-key";
const GRAPHQL_URL = "https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo";
const DAY_MS = 24 * 60 * 60 * 1_000;

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

function fetchReturning(
  result: Response | Error,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input) !== GRAPHQL_URL) throw new Error(`unexpected url ${input}`);
    if (result instanceof Error) throw result;
    return result;
  });
}

const monthlyLimit = {
  isUnlimited: false,
  requestLimit: 1_500,
  requestsUsedSinceLastRefresh: 375,
  nextRefreshTime: "2030-05-01T00:00:00Z",
  requestLimitRefreshDuration: "MONTHLY",
};

function userOutput(
  user: Record<string, unknown>,
): Record<string, unknown> {
  return {
    data: {
      user: {
        __typename: "UserOutput",
        user: {
          requestLimitInfo: monthlyLimit,
          bonusGrants: [],
          workspaces: [],
          ...user,
        },
      },
    },
  };
}

function grant(
  granted: number,
  remaining: number,
  expiration: string | null,
): Record<string, unknown> {
  return {
    requestCreditsGranted: granted,
    requestCreditsRemaining: remaining,
    expiration,
  };
}

describe("Warp adapter", () => {
  test("reads monthly included credits and the add-on balance from personal and workspace grants", async () => {
    const controller = new AbortController();
    const fetch = fetchReturning(
      response(
        userOutput({
          bonusGrants: [grant(400, 150, "2031-01-01T00:00:00Z")],
          workspaces: [
            {
              bonusGrantsInfo: {
                grants: [
                  grant(1_000, 900, "2031-02-01T00:00:00Z"),
                  grant(200, 200, "2030-04-01T00:00:00Z"),
                ],
              },
            },
            { bonusGrantsInfo: null },
          ],
        }),
      ),
    );

    const result = await warpAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0]!;
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_CREDENTIAL}`,
      },
      signal: controller.signal,
    });
    expect(Object.keys(init?.headers ?? {})).toHaveLength(3);
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("GetRequestLimitInfo");
    expect(body.variables).toEqual({
      requestContext: { clientContext: {}, osContext: {} },
    });
    expect(body.query).toContain("requestLimitInfo");

    const resetsAt = Date.parse("2030-05-01T00:00:00Z");
    const startedAt = Date.parse("2030-04-01T00:00:00Z");
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "warp",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            id: "included",
            label: "Included credits",
            scope: "general",
            type: "quota",
            usedRatio: 0.25,
            used: 375,
            limit: 1_500,
            unit: "credits",
            cycle: {
              cadence: "calendar",
              startedAt,
              resetsAt,
              durationMs: resetsAt - startedAt,
            },
          },
          {
            type: "balance",
            id: "add-on",
            label: "Add-on credits",
            scope: "product",
            value: 1_050,
            unit: "credits",
            initialLimit: 1_400,
          },
        ],
        usageGroups: [
          { id: "usage", label: "Usage", metricIds: ["included"] },
          { id: "credits", label: "Credits", metricIds: ["add-on"] },
        ],
      },
    });
  });

  test("requests only credit counts, timing, and grant amounts", async () => {
    const fetch = fetchReturning(response(userOutput({})));

    await warpAdapter.collect(context(fetch));

    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    for (const field of [
      "costCents",
      "reason",
      "userFacingMessage",
      "spendingInfo",
      "uid",
      "email",
    ]) {
      expect(body.query).not.toContain(field);
    }
  });

  test("keeps quota history and never stores the key", async () => {
    const fetch = fetchReturning(response(userOutput({})));

    const result = await warpAdapter.collect(context(fetch));
    if (!result.ok) throw new Error("expected a snapshot");

    const observation = observationFromUsage(result.snapshot);
    expect(quotaHistorySeries([observation], "included").segments).toEqual([
      {
        points: [
          expect.objectContaining({ observedAt: NOW, usedRatio: 0.25 }),
        ],
      },
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain(TEST_CREDENTIAL);
    expect(JSON.stringify(observation)).not.toContain(TEST_CREDENTIAL);
  });

  test.each([
    ["WEEKLY", 7 * DAY_MS],
    ["EVERY_TWO_WEEKS", 14 * DAY_MS],
  ])("derives the %s cycle start from the reset time", async (duration, ms) => {
    const resetsAt = NOW + 2 * DAY_MS;
    const fetch = fetchReturning(
      response(
        userOutput({
          requestLimitInfo: {
            ...monthlyLimit,
            nextRefreshTime: new Date(resetsAt).toISOString(),
            requestLimitRefreshDuration: duration,
          },
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          {
            id: "included",
            cycle: {
              cadence: "calendar",
              startedAt: resetsAt - ms,
              resetsAt,
              durationMs: ms,
            },
          },
        ],
      },
    });
  });

  test("keeps only the reset time when the cadence is unknown or inconsistent", async () => {
    const resetsAt = NOW + 20 * DAY_MS;
    const fetch = fetchReturning(
      response(
        userOutput({
          requestLimitInfo: {
            ...monthlyLimit,
            nextRefreshTime: new Date(resetsAt).toISOString(),
            requestLimitRefreshDuration: "WEEKLY",
          },
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    if (!result.ok) throw new Error("expected a snapshot");
    expect(result.snapshot.metrics[0]?.cycle).toEqual({
      cadence: "calendar",
      resetsAt,
    });
  });

  test("omits a reset time that is missing or already past", async () => {
    const fetch = fetchReturning(
      response(
        userOutput({
          requestLimitInfo: {
            ...monthlyLimit,
            nextRefreshTime: "2030-04-01T00:00:00Z",
          },
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    if (!result.ok) throw new Error("expected a snapshot");
    expect(result.snapshot.metrics[0]?.cycle).toEqual({ cadence: "calendar" });
  });

  test("clamps usage beyond the included credits", async () => {
    const fetch = fetchReturning(
      response(
        userOutput({
          requestLimitInfo: { ...monthlyLimit, requestsUsedSinceLastRefresh: 2_000 },
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [{ id: "included", usedRatio: 1, used: 1_500, limit: 1_500 }],
      },
    });
  });

  test.each([
    ["an unlimited plan", { isUnlimited: true, requestLimit: 0 }],
    ["a plan without included credits", { requestLimit: 0 }],
  ])("shows credits used as a counter for %s", async (_name, overrides) => {
    const fetch = fetchReturning(
      response(
        userOutput({
          requestLimitInfo: {
            ...monthlyLimit,
            requestsUsedSinceLastRefresh: 42,
            ...overrides,
          },
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          {
            id: "included",
            type: "counter",
            semantic: "consumed",
            value: 42,
            unit: "credits",
          },
        ],
      },
    });
  });

  test("leaves out the add-on balance when every grant has expired or none exists", async () => {
    const fetch = fetchReturning(
      response(
        userOutput({
          bonusGrants: [grant(100, 100, "2030-01-01T00:00:00Z")],
          workspaces: null,
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    if (!result.ok) throw new Error("expected a snapshot");
    expect(result.snapshot.metrics.map((metric) => metric.id)).toEqual([
      "included",
    ]);
    expect(result.snapshot.usageGroups).toEqual([
      { id: "usage", label: "Usage", metricIds: ["included"] },
    ]);
  });

  test("keeps a depleted add-on balance and skips malformed grants", async () => {
    const fetch = fetchReturning(
      response(
        userOutput({
          bonusGrants: [grant(500, 0, null), { requestCreditsGranted: "many" }],
        }),
      ),
    );

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { id: "included" },
          { id: "add-on", value: 0, initialLimit: 500 },
        ],
      },
    });
  });

  test("reports a missing key as signed out without a request", async () => {
    const fetch = fetchReturning(response(userOutput({})));

    const result = await warpAdapter.collect(
      context(fetch, { credential: { kind: "api-key", value: "  " } }),
    );

    expect(result).toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    [401, { kind: "credential_invalid" }],
    [403, { kind: "credential_invalid" }],
    [500, { kind: "temporary_error" }],
    [404, { kind: "provider_changed" }],
  ])("maps HTTP %i", async (status, health) => {
    const fetch = fetchReturning(response({ message: "nope" }, status));

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toEqual({ ok: false, health });
  });

  test("honors Retry-After on rate limiting", async () => {
    const fetch = fetchReturning(
      response("Rate exceeded.", 429, { "retry-after": "120" }),
    );

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
  });

  test.each([
    [
      "an authentication GraphQL error",
      { errors: [{ message: "Unauthenticated: invalid API key" }] },
      { kind: "credential_invalid" },
    ],
    [
      "another GraphQL error",
      { errors: [{ message: "Cannot query field" }] },
      { kind: "provider_changed" },
    ],
    [
      "an authentication user-facing error",
      {
        data: {
          user: { __typename: "UserFacingError", error: { message: "User not authenticated" } },
        },
      },
      { kind: "credential_invalid" },
    ],
    [
      "another user-facing error",
      {
        data: {
          user: { __typename: "UserFacingError", error: { message: "Something went wrong" } },
        },
      },
      { kind: "provider_changed" },
    ],
    ["a response without data", { data: null }, { kind: "provider_changed" }],
    [
      "a changed limit shape",
      userOutput({ requestLimitInfo: { requestLimit: "lots" } }),
      { kind: "provider_changed" },
    ],
    ["a non-object body", ["unexpected"], { kind: "provider_changed" }],
  ])("maps %s", async (_name, body, health) => {
    const fetch = fetchReturning(response(body));

    const result = await warpAdapter.collect(context(fetch));

    expect(result).toEqual({ ok: false, health });
  });

  test("maps network failures and unreadable bodies", async () => {
    await expect(
      warpAdapter.collect(context(fetchReturning(new TypeError("offline")))),
    ).resolves.toEqual({ ok: false, health: { kind: "temporary_error" } });

    await expect(
      warpAdapter.collect(
        context(fetchReturning(new Response("<html>", { status: 200 }))),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "provider_changed" } });
  });
});
