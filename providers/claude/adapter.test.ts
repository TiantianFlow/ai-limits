import { describe, expect, test, vi } from "vitest";

import { claudeAdapter } from "./adapter";

const NOW = 1_800_000_000_000;
const FIVE_HOUR_RESET = "2030-01-15T10:00:00.000Z";
const WEEKLY_RESET = "2030-01-20T12:00:00.000Z";
const SONNET_RESET = "2030-01-21T12:00:00.000Z";
const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(
  fetch: typeof globalThis.fetch,
  signal = new AbortController().signal,
) {
  return { fetch, now: NOW, signal };
}

function usageFixture(overrides: Record<string, unknown> = {}) {
  return {
    five_hour: {
      utilization: 16,
      resets_at: FIVE_HOUR_RESET,
    },
    seven_day: {
      utilization: 10,
      resets_at: WEEKLY_RESET,
    },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
      {
        kind: "weekly_scoped",
        percent: 25,
        resets_at: SONNET_RESET,
        scope: {
          model: {
            display_name: "Claude Sonnet 4.5",
            raw_model_id: "secret-model-id",
          },
          raw_scope_id: "secret-scope-id",
        },
        raw_limit_id: "secret-limit-id",
      },
    ],
    extra_usage: {
      is_enabled: true,
      used_credits: 4_132,
      monthly_limit: 100_000,
      currency: "USD",
    },
    ...overrides,
  };
}

describe("Claude adapter", () => {
  test("keeps plan and quota data without collecting the account email", async () => {
    const controller = new AbortController();
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([
          {
            uuid: "api-only",
            name: "API Organization",
            capabilities: ["api"],
          },
          {
            uuid: "chat/org",
            name: "Claude Max",
            capabilities: ["api", "chat"],
          },
        ]),
      )
      .mockResolvedValueOnce(response(usageFixture()))
      .mockResolvedValueOnce(
        response({ email_address: "person@example.com", full_name: "Person" }),
      );

    const result = await claudeAdapter.collect(
      context(injectedFetch, controller.signal),
    );

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerId: "claude",
        planLabel: "Claude Max",
        source: "web-session",
        fetchedAt: NOW,
        windows: [
          {
            id: "five-hour",
            label: "5-hour messages",
            kind: "rolling",
            usedRatio: 0.16,
            resetsAt: Date.parse(FIVE_HOUR_RESET),
            durationMs: FIVE_HOURS_MS,
            sourceSemantics: "used",
          },
          {
            id: "weekly",
            label: "Weekly messages",
            kind: "rolling",
            usedRatio: 0.1,
            resetsAt: Date.parse(WEEKLY_RESET),
            durationMs: SEVEN_DAYS_MS,
            sourceSemantics: "used",
          },
          {
            id: "weekly-scoped-claude-sonnet-4-5",
            label: "Weekly Claude Sonnet 4.5",
            kind: "model",
            usedRatio: 0.25,
            resetsAt: Date.parse(SONNET_RESET),
            durationMs: SEVEN_DAYS_MS,
            sourceSemantics: "used",
          },
        ],
        credits: [
          {
            id: "extra-usage",
            label: "Extra usage",
            unit: "USD",
            used: 41.32,
            limit: 1_000,
          },
        ],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            windowIds: [
              "five-hour",
              "weekly",
              "weekly-scoped-claude-sonnet-4-5",
            ],
            creditIds: ["extra-usage"],
          },
        ],
      },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(2);
    expect(injectedFetch).toHaveBeenNthCalledWith(
      1,
      "https://claude.ai/api/organizations",
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    expect(injectedFetch).toHaveBeenNthCalledWith(
      2,
      "https://claude.ai/api/organizations/chat%2Forg/usage",
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(JSON.stringify(result)).not.toContain("chat/org");
    expect(JSON.stringify(result)).not.toContain("capabilities");
    expect(JSON.stringify(result)).not.toContain("secret-");
  });

  test("prefers a non-API-only organization when none has chat capability", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([
          { uuid: "api", name: "API", capabilities: ["api"] },
          {
            uuid: "team",
            name: "Team",
            capabilities: ["billing", "members"],
          },
        ]),
      )
      .mockResolvedValueOnce(response(usageFixture()))
      .mockResolvedValueOnce(response({}, 500));

    const result = await claudeAdapter.collect(context(injectedFetch));

    expect(result.ok).toBe(true);
    expect(injectedFetch.mock.calls[1]?.[0]).toBe(
      "https://claude.ai/api/organizations/team/usage",
    );
  });

  test("falls back to the first valid organization when all are API-only", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([
          { uuid: "", name: "Invalid", capabilities: ["chat"] },
          { uuid: "api-first", name: "API One", capabilities: ["api"] },
          { uuid: "api-second", name: "API Two", capabilities: ["api"] },
        ]),
      )
      .mockResolvedValueOnce(response(usageFixture()))
      .mockResolvedValueOnce(response({}, 500));

    const result = await claudeAdapter.collect(context(injectedFetch));

    expect(result.ok).toBe(true);
    expect(injectedFetch.mock.calls[1]?.[0]).toBe(
      "https://claude.ai/api/organizations/api-first/usage",
    );
  });

  test("omits null optional windows and disabled extra usage instead of inventing zero values", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            seven_day: null,
            seven_day_opus: null,
            seven_day_sonnet: null,
            limits: null,
            extra_usage: {
              is_enabled: false,
              used_credits: null,
              monthly_limit: null,
              currency: null,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(response({ email_address: null }));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: true,
      snapshot: {
        providerId: "claude",
        source: "web-session",
        fetchedAt: NOW,
        windows: [
          {
            id: "five-hour",
            label: "5-hour messages",
            kind: "rolling",
            usedRatio: 0.16,
            resetsAt: Date.parse(FIVE_HOUR_RESET),
            durationMs: FIVE_HOURS_MS,
            sourceSemantics: "used",
          },
        ],
        credits: [],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            windowIds: ["five-hour"],
            creditIds: [],
          },
        ],
      },
    });
  });

  test("omits an inactive named window with a null reset while preserving valid windows", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            seven_day_sonnet: {
              utilization: 0,
              resets_at: null,
              account_uuid: "redacted-account",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(response({}));

    const result = await claudeAdapter.collect(context(injectedFetch));

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          { id: "five-hour", resetsAt: Date.parse(FIVE_HOUR_RESET) },
          { id: "weekly", resetsAt: Date.parse(WEEKLY_RESET) },
          {
            id: "weekly-scoped-claude-sonnet-4-5",
            resetsAt: Date.parse(SONNET_RESET),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("redacted-account");
  });

  test("ignores unfamiliar promotion limits while retaining recognized limits", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            limits: [
              {
                kind: "temporary_promotion",
                percent: 12,
                resets_at: WEEKLY_RESET,
                promotion: { name: "boosted weekly limit" },
              },
              {
                kind: "weekly_scoped",
                percent: 25,
                resets_at: SONNET_RESET,
                scope: {
                  model: {
                    display_name: "Claude Sonnet 4.5",
                    raw_model_id: "secret-model-id",
                  },
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(response({}));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          { id: "five-hour" },
          { id: "weekly" },
          { id: "weekly-scoped-claude-sonnet-4-5" },
        ],
      },
    });
  });

  test("ignores unfamiliar extra-usage data without erasing core windows", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            limits: null,
            extra_usage: {
              is_enabled: "promotional",
              promotion: { name: "temporary boost" },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(response({}));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [{ id: "five-hour" }, { id: "weekly" }],
        credits: [],
      },
    });
  });

  test("ignores changed optional model windows without erasing core windows", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            seven_day_opus: { status: "temporarily_promoted" },
            seven_day_sonnet: { utilization: "25", resets_at: SONNET_RESET },
          }),
        ),
      )
      .mockResolvedValueOnce(response({}));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [
          { id: "five-hour" },
          { id: "weekly" },
          { id: "weekly-scoped-claude-sonnet-4-5" },
        ],
      },
    });
  });

  test("rejects an active named window with a null reset", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            seven_day_sonnet: { utilization: 1, resets_at: null },
          }),
        ),
      );

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(2);
  });

  test("rejects a response with no active quota window", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            five_hour: null,
            seven_day: null,
            seven_day_opus: null,
            seven_day_sonnet: null,
            limits: null,
          }),
        ),
      );

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["organizations", 401],
    ["usage", 401],
  ] as const)("maps a %s HTTP 401 to signed out", async (stage, status) => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>();
    if (stage === "usage") {
      injectedFetch.mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      );
    }
    injectedFetch.mockResolvedValueOnce(response({}, status));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "signed_out" },
    });
  });

  test.each([
    ["organizations", 429],
    ["organizations", 500],
    ["usage", 503],
  ] as const)("maps a %s HTTP %i to a temporary error", async (stage, status) => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>();
    if (stage === "usage") {
      injectedFetch.mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      );
    }
    injectedFetch.mockResolvedValueOnce(response({}, status));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test.each([
    ["invalid organizations", { organizations: [] }],
    [
      "invalid usage",
      {
        five_hour: { utilization: 116, resets_at: FIVE_HOUR_RESET },
        seven_day: null,
        extra_usage: null,
      },
    ],
  ] as const)("maps malformed 2xx %s to provider changed", async (stage, body) => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>();
    if (stage === "invalid usage") {
      injectedFetch.mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      );
    }
    injectedFetch.mockResolvedValueOnce(response(body));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("maps an invalid reset timestamp to provider changed", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(response(usageFixture({
        five_hour: { utilization: 16, resets_at: "January 15, 2030" },
      })));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    [
      "an unknown scoped kind",
      {
        kind: "monthly_scoped",
        percent: 25,
        resets_at: SONNET_RESET,
        scope: { model: { display_name: "Claude Sonnet 4.5" } },
      },
    ],
    [
      "an out-of-range scoped percent",
      {
        kind: "weekly_scoped",
        percent: 101,
        resets_at: SONNET_RESET,
        scope: { model: { display_name: "Claude Sonnet 4.5" } },
      },
    ],
    [
      "a non-ISO scoped reset",
      {
        kind: "weekly_scoped",
        percent: 25,
        resets_at: "next week",
        scope: { model: { display_name: "Claude Sonnet 4.5" } },
      },
    ],
    [
      "a missing scoped model name",
      {
        kind: "weekly_scoped",
        percent: 25,
        resets_at: SONNET_RESET,
        scope: { model: {} },
      },
    ],
    [
      "a scoped model name without a stable identifier",
      {
        kind: "weekly_scoped",
        percent: 25,
        resets_at: SONNET_RESET,
        scope: { model: { display_name: "!!!" } },
      },
    ],
  ] as const)("ignores %s without erasing core windows", async (_description, limit) => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(response(usageFixture({ limits: [limit] })));

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [{ id: "five-hour" }, { id: "weekly" }],
      },
    });
  });

  test.each([null, undefined])(
    "omits an optional %s generic limits list",
    async (limits) => {
      const injectedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          response([{ uuid: "org", capabilities: ["chat"] }]),
        )
        .mockResolvedValueOnce(
          response(
            usageFixture({
              limits,
              seven_day_sonnet: {
                utilization: 25,
                resets_at: SONNET_RESET,
              },
            }),
          ),
        )
        .mockResolvedValueOnce(response({}));

      const result = await claudeAdapter.collect(context(injectedFetch));

      expect(result).toMatchObject({
        ok: true,
        snapshot: {
          windows: [
            { id: "five-hour" },
            { id: "weekly" },
            { id: "weekly-sonnet" },
          ],
        },
      });
    },
  );

  test("rejects scoped model names that collide after ID sanitization", async () => {
    const scopedLimit = (displayName: string) => ({
      kind: "weekly_scoped",
      percent: 25,
      resets_at: SONNET_RESET,
      scope: { model: { display_name: displayName } },
    });
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response([{ uuid: "org", capabilities: ["chat"] }]),
      )
      .mockResolvedValueOnce(
        response(
          usageFixture({
            limits: [
              scopedLimit("Claude Sonnet 4.5"),
              scopedLimit("Claude-Sonnet 4 5"),
            ],
          }),
        ),
      );

    await expect(claudeAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(2);
  });

  test("maps an aborted request to a temporary error", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Timed out", "AbortError"));
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(controller.signal.reason);

    await expect(
      claudeAdapter.collect(context(injectedFetch, controller.signal)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
