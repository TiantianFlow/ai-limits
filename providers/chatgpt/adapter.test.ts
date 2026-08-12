import { describe, expect, test, vi } from "vitest";

import { chatGptAdapter } from "./adapter";

const NOW = 1_800_000_000_000;
const RESET_SECONDS = 1_800_000_900;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(fetch: typeof globalThis.fetch, signal = new AbortController().signal) {
  return { fetch, now: NOW, signal };
}

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

function usageFixture() {
  return {
    plan_type: "plus",
    credits: { balance: 414 },
    rate_limit: {
      primary_window: {
        used_percent: 72,
        reset_at: RESET_SECONDS,
        limit_window_seconds: 18_000,
      },
      secondary_window: {
        used_percent: 71,
        reset_at: RESET_SECONDS + 604_800,
        limit_window_seconds: 604_800,
      },
    },
  };
}

describe("ChatGPT adapter", () => {
  test("normalizes usage without returning or sending the session token outside the usage request", async () => {
    const accessToken = jwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-test",
      },
    });
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken }))
      .mockResolvedValueOnce(response(usageFixture()));

    const result = await chatGptAdapter.collect(context(injectedFetch));

    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerId: "chatgpt",
        planLabel: "plus",
        source: "web-session",
        fetchedAt: NOW,
        windows: [
          {
            id: "five-hour",
            label: "5-hour messages",
            kind: "rolling",
            usedRatio: 0.72,
            resetsAt: RESET_SECONDS * 1_000,
            durationMs: 18_000_000,
            sourceSemantics: "used",
          },
          {
            id: "weekly",
            label: "Weekly messages",
            kind: "rolling",
            usedRatio: 0.71,
            resetsAt: (RESET_SECONDS + 604_800) * 1_000,
            durationMs: 604_800_000,
            sourceSemantics: "used",
          },
        ],
        credits: [
          {
            id: "credits",
            label: "Credits",
            unit: "credits",
            remaining: 414,
          },
        ],
        usageGroups: [
          {
            id: "usage",
            label: "Usage",
            windowIds: ["five-hour", "weekly"],
            creditIds: ["credits"],
          },
        ],
      },
    });
    expect(injectedFetch).toHaveBeenNthCalledWith(
      1,
      "https://chatgpt.com/api/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
    expect(injectedFetch.mock.calls[0]?.[1]).not.toHaveProperty("headers.Authorization");
    expect(injectedFetch).toHaveBeenNthCalledWith(
      2,
      "https://chatgpt.com/backend-api/codex/usage",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "ChatGPT-Account-Id": "account-test",
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(JSON.stringify(result)).not.toContain("account-test");
  });

  test("keeps a valid primary window when the optional secondary window is null", async () => {
    const accessToken = jwt({ chatgpt_account_id: "account-test" });
    const usage = usageFixture();
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken }))
      .mockResolvedValueOnce(
        response({
          ...usage,
          rate_limit: { ...usage.rate_limit, secondary_window: null },
        }),
      );

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: [expect.objectContaining({ id: "five-hour", usedRatio: 0.72 })],
        credits: [expect.objectContaining({ remaining: 414 })],
      },
    });
  });

  test("falls back to the legacy usage route when the current route is absent", async () => {
    const accessToken = jwt({ chatgpt_account_id: "account-direct" });
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken }))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(usageFixture()));

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { planLabel: "plus" },
    });
    expect(injectedFetch).toHaveBeenNthCalledWith(
      3,
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "ChatGPT-Account-Id": "account-direct",
        },
      }),
    );
  });

  test("maps a missing session token to signed out", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ user: { id: "redacted-user" } }));

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "signed_out" },
    });
    expect(injectedFetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["session", 401],
    ["usage", 401],
  ] as const)("maps a %s HTTP 401 to signed out", async (stage, status) => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>();
    if (stage === "usage") {
      injectedFetch.mockResolvedValueOnce(response({ accessToken: "redacted" }));
    }
    injectedFetch.mockResolvedValueOnce(response({}, status));

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "signed_out" },
    });
  });

  test.each([429, 500, 503])(
    "maps HTTP %i to a temporary error",
    async (status) => {
      const injectedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ accessToken: "redacted" }))
        .mockResolvedValueOnce(response({}, status));

      await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toEqual({
        ok: false,
        health: { kind: "temporary_error" },
      });
    },
  );

  test("preserves Retry-After metadata on a transient usage response", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken: "redacted" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": "120",
          },
        }),
      );

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
  });

  test("maps a successful response with an invalid usage shape to provider changed", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken: "redacted" }))
      .mockResolvedValueOnce(
        response({
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: "72",
              reset_at: RESET_SECONDS,
              limit_window_seconds: 18_000,
            },
          },
        }),
      );

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test("keeps valid quota windows when the optional credit shape changes", async () => {
    const accessToken = jwt({ chatgpt_account_id: "account-test" });
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken }))
      .mockResolvedValueOnce(
        response({
          ...usageFixture(),
          credits: { balance: { unexpected: true } },
        }),
      );

    await expect(chatGptAdapter.collect(context(injectedFetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        windows: expect.arrayContaining([
          expect.objectContaining({ id: "five-hour" }),
          expect.objectContaining({ id: "weekly" }),
        ]),
        credits: [],
      },
    });
  });

  test("maps an aborted request to a temporary error", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Timed out", "AbortError"));
    const injectedFetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(controller.signal.reason);

    await expect(
      chatGptAdapter.collect(context(injectedFetch, controller.signal)),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });
});
