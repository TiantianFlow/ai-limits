import type { ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  chatGptCreditsSchema,
  chatGptSessionSchema,
  chatGptUsageSchema,
  type ChatGptUsageWindow,
} from "./schema";

const SESSION_ENDPOINT = "https://chatgpt.com/api/auth/session";
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/codex/usage";
const LEGACY_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CHATGPT_ORIGIN = "https://chatgpt.com/*";
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WEEK_SECONDS = 7 * DAY_SECONDS;

function healthForStatus(status: number): ProviderHealth {
  if (status === 401) {
    return { kind: "signed_out" };
  }

  if (status === 429 || status >= 500) {
    return { kind: "temporary_error" };
  }

  return { kind: "provider_changed" };
}

function windowIdentity(durationSeconds: number): Pick<QuotaWindow, "id" | "label"> {
  if (durationSeconds === 5 * HOUR_SECONDS) {
    return { id: "five-hour", label: "5-hour messages" };
  }

  if (durationSeconds === WEEK_SECONDS) {
    return { id: "weekly", label: "Weekly messages" };
  }

  if (durationSeconds % DAY_SECONDS === 0) {
    const days = durationSeconds / DAY_SECONDS;
    return {
      id: `${days}-day`,
      label: `${days}-day messages`,
    };
  }

  const hours = durationSeconds / HOUR_SECONDS;
  return {
    id: `${hours}-hour`,
    label: `${hours}-hour messages`,
  };
}

function normalizeWindow(window: ChatGptUsageWindow): QuotaWindow {
  return {
    ...windowIdentity(window.limit_window_seconds),
    kind: "rolling",
    usedRatio: window.used_percent / 100,
    resetsAt: window.reset_at * 1_000,
    durationMs: window.limit_window_seconds * 1_000,
    sourceSemantics: "used",
  };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

function chatGptAccountId(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(
      decodeBase64Url(accessToken.split(".")[1] ?? ""),
    ) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"];
    const nested =
      typeof auth === "object" && auth !== null
        ? (auth as Record<string, unknown>).chatgpt_account_id
        : undefined;
    const value = nested ?? payload.chatgpt_account_id;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function collectChatGpt({
  fetch: injectedFetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const sessionResponse = await injectedFetch(SESSION_ENDPOINT, {
      method: "GET",
      credentials: "include",
      signal,
    });

    if (!sessionResponse.ok) {
      return { ok: false, health: healthForStatus(sessionResponse.status) };
    }

    const session = chatGptSessionSchema.safeParse(await parseJson(sessionResponse));
    if (!session.success || !session.data.accessToken) {
      return { ok: false, health: { kind: "signed_out" } };
    }

    const accountId = chatGptAccountId(session.data.accessToken);
    const headers = {
      Authorization: `Bearer ${session.data.accessToken}`,
      ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
    };
    const usageRequest = {
      method: "GET",
      credentials: "include",
      signal,
      headers,
    } as const;
    let usageResponse = await injectedFetch(USAGE_ENDPOINT, usageRequest);
    if (usageResponse.status === 404 || usageResponse.status === 405) {
      usageResponse = await injectedFetch(LEGACY_USAGE_ENDPOINT, usageRequest);
    }

    if (!usageResponse.ok) {
      return { ok: false, health: healthForStatus(usageResponse.status) };
    }

    const usage = chatGptUsageSchema.safeParse(await parseJson(usageResponse));
    if (!usage.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const windows = [
      usage.data.rate_limit.primary_window,
      usage.data.rate_limit.secondary_window,
    ].flatMap((window) => (window ? [normalizeWindow(window)] : []));

    if (windows.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const creditSection = chatGptCreditsSchema.safeParse(usage.data.credits);
    const credits = creditSection.success
      ? [
          {
            id: "credits",
            label: "Credits",
            unit: "credits",
            remaining: creditSection.data.balance,
          },
        ]
      : [];

    return {
      ok: true,
      snapshot: {
        providerId: "chatgpt",
        planLabel: usage.data.plan_type,
        source: "web-session",
        fetchedAt: now,
        windows,
        credits,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const chatGptAdapter: ProviderAdapter = {
  id: "chatgpt",
  capabilities: { browserSession: true },
  optionalOrigins: [CHATGPT_ORIGIN],
  collect: collectChatGpt,
};
