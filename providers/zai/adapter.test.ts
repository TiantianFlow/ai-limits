import { describe, expect, test, vi } from "vitest";

import {
  observationFromUsage,
  quotaHistorySeries,
} from "../../domain/history";
import type { CollectionContext } from "../types";
import { zaiAdapter } from "./adapter";

const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-zai-key";
const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const HOUR_MS = 60 * 60 * 1_000;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;

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
    if (String(input) !== QUOTA_URL) throw new Error(`unexpected url ${input}`);
    if (result instanceof Error) throw result;
    return result;
  });
}

function envelope(
  limits: unknown[],
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    code: 200,
    msg: "success",
    success: true,
    data: { level: "pro", limits, ...data },
  };
}

const fiveHourCredits = {
  type: "CREDIT_LIMIT",
  unit: 3,
  number: 5,
  usage: 2_000,
  currentValue: 500,
  remaining: 1_500,
  percentage: 25,
  nextResetTime: NOW + 2 * HOUR_MS,
};
const weeklyCredits = {
  type: "CREDIT_LIMIT",
  unit: 6,
  number: 1,
  usage: 10_000,
  currentValue: 1_000,
  remaining: 9_000,
  percentage: 10,
  nextResetTime: NOW + 3 * 24 * HOUR_MS,
};
const monthlyMcp = {
  type: "TIME_LIMIT",
  unit: 5,
  number: 1,
  usage: 1_000,
  currentValue: 42,
  remaining: 958,
  percentage: 4,
  nextResetTime: NOW + 10 * 24 * HOUR_MS,
  usageDetails: [{ modelCode: "search-prime", usage: 42 }],
};

describe("GLM Coding Plan adapter", () => {
  test("reads the 5-hour, weekly, and MCP allowances with reset times and the plan", async () => {
    const controller = new AbortController();
    const fetch = fetchReturning(
      response(
        envelope([weeklyCredits, monthlyMcp, fiveHourCredits], {
          planName: "Synthetic Account Team Plan",
        }),
      ),
    );

    const result = await zaiAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(QUOTA_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TEST_CREDENTIAL}`,
      },
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "zai",
        planLabel: "pro",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "quota",
            id: "five-hour",
            label: "5-hour",
            scope: "general",
            usedRatio: 0.25,
            used: 500,
            limit: 2_000,
            unit: "credits",
            cycle: {
              cadence: "rolling",
              resetsAt: NOW + 2 * HOUR_MS,
              durationMs: FIVE_HOURS_MS,
            },
          },
          {
            type: "quota",
            id: "weekly",
            label: "Weekly",
            scope: "general",
            usedRatio: 0.1,
            used: 1_000,
            limit: 10_000,
            unit: "credits",
            cycle: {
              cadence: "rolling",
              resetsAt: NOW + 3 * 24 * HOUR_MS,
              durationMs: WEEK_MS,
            },
          },
          {
            type: "quota",
            id: "mcp",
            label: "MCP tools",
            scope: "feature",
            usedRatio: 0.042,
            used: 42,
            limit: 1_000,
            unit: "calls",
            cycle: { resetsAt: NOW + 10 * 24 * HOUR_MS },
          },
        ],
        usageGroups: [
          { id: "usage", label: "Usage", metricIds: ["five-hour", "weekly"] },
          { id: "mcp-tools", label: "MCP tools", metricIds: ["mcp"] },
        ],
      },
    });
  });

  test("keeps quota History for both windows without storing the key or raw response", async () => {
    const fetch = fetchReturning(
      response(envelope([fiveHourCredits, weeklyCredits])),
    );

    const result = await zaiAdapter.collect(context(fetch));
    if (!result.ok) throw new Error("expected a snapshot");

    const observation = observationFromUsage(result.snapshot);
    expect(quotaHistorySeries([observation], "five-hour").segments).toEqual([
      {
        points: [
          expect.objectContaining({ observedAt: NOW, usedRatio: 0.25 }),
        ],
      },
    ]);
    expect(quotaHistorySeries([observation], "weekly").segments).toHaveLength(1);
    expect(JSON.stringify(result.snapshot)).not.toContain(TEST_CREDENTIAL);
    expect(JSON.stringify(observation)).not.toContain(TEST_CREDENTIAL);
  });

  test("falls back to the reported percentage for legacy token windows without counts", async () => {
    const fetch = fetchReturning(
      response(
        envelope([
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 37 },
          { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 140 },
        ]),
      ),
    );

    const result = await zaiAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          {
            id: "five-hour",
            usedRatio: 0.37,
            cycle: { cadence: "rolling" },
          },
          { id: "weekly", usedRatio: 1, cycle: { cadence: "rolling" } },
        ],
      },
    });
    if (!result.ok) throw new Error("expected a snapshot");
    for (const metric of result.snapshot.metrics) {
      expect(metric).not.toHaveProperty("used");
      expect(metric).not.toHaveProperty("limit");
      expect(metric.cycle).not.toHaveProperty("resetsAt");
      expect(metric.cycle).not.toHaveProperty("durationMs");
    }
  });

  test("derives used credits from the remaining count when currentValue is missing", async () => {
    const fetch = fetchReturning(
      response(
        envelope([
          { ...fiveHourCredits, currentValue: undefined, remaining: 1_200 },
        ]),
      ),
    );

    const result = await zaiAdapter.collect(context(fetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [{ id: "five-hour", usedRatio: 0.4, used: 800, limit: 2_000 }],
      },
    });
  });

  test("drops reset times that are past or beyond the window instead of inventing pace", async () => {
    const fetch = fetchReturning(
      response(
        envelope([
          // Eight hours ahead: the reported timezone slip on 5-hour resets.
          { ...fiveHourCredits, nextResetTime: NOW + 8 * HOUR_MS },
          { ...weeklyCredits, nextResetTime: NOW - 1 },
        ]),
      ),
    );

    const result = await zaiAdapter.collect(context(fetch));

    if (!result.ok) throw new Error("expected a snapshot");
    expect(result.snapshot.metrics.map((metric) => metric.cycle)).toEqual([
      { cadence: "rolling" },
      { cadence: "rolling" },
    ]);
  });

  test("keeps recognized windows and skips unknown, malformed, or odd-duration entries", async () => {
    const fetch = fetchReturning(
      response(
        envelope(
          [
            { type: "FUTURE_LIMIT", unit: 3, number: 5, percentage: 99 },
            { type: "CREDIT_LIMIT", unit: 3, number: "5", percentage: 50 },
            { type: "CREDIT_LIMIT", unit: 1, number: 30, percentage: 50 },
            fiveHourCredits,
          ],
          { level: null },
        ),
      ),
    );

    const result = await zaiAdapter.collect(context(fetch));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a snapshot");
    expect(result.snapshot.metrics.map((metric) => metric.id)).toEqual([
      "five-hour",
    ]);
    expect(result.snapshot).not.toHaveProperty("planLabel");
    expect(result.snapshot.usageGroups).toEqual([
      { id: "usage", label: "Usage", metricIds: ["five-hour"] },
    ]);
  });

  test.each([
    ["no recognized plan window", envelope([monthlyMcp])],
    ["a missing limits array", { code: 200, success: true, data: {} }],
    ["missing data", { code: 200, success: true, data: null }],
    ["a non-object body", ["unexpected"]],
    ["an unknown error code", { code: 500, success: false, msg: "error" }],
  ])("reports schema drift for %s", async (_name, body) => {
    const result = await zaiAdapter.collect(
      context(fetchReturning(response(body))),
    );

    expect(result).toEqual({ ok: false, health: { kind: "provider_changed" } });
  });

  test("reports a key without Coding Plan limits as unable to read usage", async () => {
    const result = await zaiAdapter.collect(
      context(fetchReturning(response(envelope([])))),
    );

    expect(result).toEqual({
      ok: false,
      health: { kind: "credential_scope_required" },
    });
  });

  test.each([
    ["HTTP 401", response({}, 401)],
    ["HTTP 403", response({}, 403)],
    ["body code 1002", response({ code: 1002, success: false, msg: "Invalid token" })],
    ["body code 401 as text", response({ code: "401", success: false, msg: "token expired" })],
  ])("reports an invalid key for %s", async (_name, reply) => {
    const result = await zaiAdapter.collect(context(fetchReturning(reply)));

    expect(result).toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
  });

  test("reports rate limiting with the provider's retry time", async () => {
    const result = await zaiAdapter.collect(
      context(fetchReturning(response({}, 429, { "Retry-After": "120" }))),
    );

    expect(result).toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
  });

  test.each([
    ["body rate-limit code", response({ code: 1302, success: false, msg: "busy" })],
    ["server error", response({}, 503)],
    ["network failure", new TypeError("network down")],
  ])("reports a temporary error for a %s", async (_name, reply) => {
    const result = await zaiAdapter.collect(context(fetchReturning(reply)));

    expect(result).toEqual({ ok: false, health: { kind: "temporary_error" } });
  });

  test("reports schema drift for a non-JSON body and an unexpected status", async () => {
    const html = vi.fn<typeof globalThis.fetch>(
      async () => new Response("<html></html>", { status: 200 }),
    );
    expect(await zaiAdapter.collect(context(html))).toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });

    expect(
      await zaiAdapter.collect(context(fetchReturning(response({}, 404)))),
    ).toEqual({ ok: false, health: { kind: "provider_changed" } });
  });

  test("does not call Z.ai without a key", async () => {
    const fetch = fetchReturning(response(envelope([fiveHourCredits])));

    expect(
      await zaiAdapter.collect(context(fetch, { credential: undefined })),
    ).toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(
      await zaiAdapter.collect(
        context(fetch, { credential: { kind: "api-key", value: "   " } }),
      ),
    ).toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
