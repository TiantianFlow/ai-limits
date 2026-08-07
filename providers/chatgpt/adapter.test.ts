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

describe("ChatGPT adapter", () => {
  test("normalizes usage without returning or sending the session token outside the usage request", async () => {
    const injectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ accessToken: "redacted" }))
      .mockResolvedValueOnce(
        response({
          plan_type: "plus",
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
        }),
      );

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
        credits: [],
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
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer redacted" },
      }),
    );
    expect(JSON.stringify(result)).not.toContain("redacted");
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
