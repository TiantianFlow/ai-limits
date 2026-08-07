import type { ProviderHealth, QuotaWindow } from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  chatGptSessionSchema,
  chatGptUsageSchema,
  type ChatGptUsageWindow,
} from "./schema";

const SESSION_ENDPOINT = "https://chatgpt.com/api/auth/session";
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
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

    const usageResponse = await injectedFetch(USAGE_ENDPOINT, {
      method: "GET",
      credentials: "include",
      signal,
      headers: { Authorization: `Bearer ${session.data.accessToken}` },
    });

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

    return {
      ok: true,
      snapshot: {
        providerId: "chatgpt",
        planLabel: usage.data.plan_type,
        source: "web-session",
        fetchedAt: now,
        windows,
        credits: [],
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
