import type {
  CreditBalance,
  ProviderHealth,
  QuotaWindow,
} from "../../domain/model";
import type {
  CollectionContext,
  CollectionResult,
  ProviderAdapter,
} from "../types";
import {
  claudeAccountSchema,
  claudeOrganizationListSchema,
  claudeOrganizationSchema,
  claudeUsageSchema,
  type ClaudeOrganization,
  type ClaudeUsage,
  type ClaudeUsageWindow,
} from "./schema";

const ORGANIZATIONS_ENDPOINT = "https://claude.ai/api/organizations";
const ACCOUNT_ENDPOINT = "https://claude.ai/api/account";
const CLAUDE_ORIGIN = "https://claude.ai/*";
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

const REQUEST_INIT = {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
} as const;

function healthForStatus(status: number): ProviderHealth {
  if (status === 401) {
    return { kind: "signed_out" };
  }

  if (status === 429 || status >= 500) {
    return { kind: "temporary_error" };
  }

  return { kind: "provider_changed" };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function capabilityNames(organization: ClaudeOrganization): string[] {
  return (organization.capabilities ?? []).map((capability) =>
    capability.toLowerCase(),
  );
}

function isApiOnly(organization: ClaudeOrganization): boolean {
  const capabilities = capabilityNames(organization);
  return capabilities.length > 0 && capabilities.every((name) => name === "api");
}

function selectOrganization(value: unknown): ClaudeOrganization | undefined {
  const list = claudeOrganizationListSchema.safeParse(value);
  if (!list.success) {
    return undefined;
  }

  const organizations = list.data.flatMap((candidate) => {
    const parsed = claudeOrganizationSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });

  return (
    organizations.find((organization) =>
      capabilityNames(organization).includes("chat"),
    ) ??
    organizations.find((organization) => !isApiOnly(organization)) ??
    organizations[0]
  );
}

function normalizeWindow(
  window: ClaudeUsageWindow,
  identity: Pick<QuotaWindow, "id" | "label" | "kind">,
  durationMs: number,
): QuotaWindow {
  return {
    ...identity,
    usedRatio: window.utilization / 100,
    resetsAt: Date.parse(window.resets_at),
    durationMs,
    sourceSemantics: "used",
  };
}

function normalizeCredits(
  extraUsage: ClaudeUsage["extra_usage"],
): CreditBalance[] {
  if (!extraUsage?.is_enabled) {
    return [];
  }

  return [
    {
      id: "extra-usage",
      label: "Extra usage",
      unit: extraUsage.currency,
      used: extraUsage.used_credits / 100,
      limit: extraUsage.monthly_limit / 100,
    },
  ];
}

async function accountLabel(
  injectedFetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const response = await injectedFetch(ACCOUNT_ENDPOINT, {
      ...REQUEST_INIT,
      signal,
    });
    if (!response.ok) {
      return undefined;
    }

    const account = claudeAccountSchema.safeParse(await parseJson(response));
    return account.success ? (account.data.email_address ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

async function collectClaude({
  fetch: injectedFetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  try {
    const organizationsResponse = await injectedFetch(ORGANIZATIONS_ENDPOINT, {
      ...REQUEST_INIT,
      signal,
    });
    if (!organizationsResponse.ok) {
      return {
        ok: false,
        health: healthForStatus(organizationsResponse.status),
      };
    }

    const organization = selectOrganization(await parseJson(organizationsResponse));
    if (!organization) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const usageResponse = await injectedFetch(
      `${ORGANIZATIONS_ENDPOINT}/${encodeURIComponent(organization.uuid)}/usage`,
      { ...REQUEST_INIT, signal },
    );
    if (!usageResponse.ok) {
      return { ok: false, health: healthForStatus(usageResponse.status) };
    }

    const usage = claudeUsageSchema.safeParse(await parseJson(usageResponse));
    if (!usage.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const windows = [
      usage.data.five_hour
        ? normalizeWindow(
            usage.data.five_hour,
            { id: "five-hour", label: "5-hour messages", kind: "rolling" },
            5 * HOUR_MS,
          )
        : undefined,
      usage.data.seven_day
        ? normalizeWindow(
            usage.data.seven_day,
            { id: "weekly", label: "Weekly messages", kind: "rolling" },
            7 * DAY_MS,
          )
        : undefined,
      usage.data.seven_day_opus
        ? normalizeWindow(
            usage.data.seven_day_opus,
            { id: "weekly-opus", label: "Weekly Opus", kind: "model" },
            7 * DAY_MS,
          )
        : undefined,
      usage.data.seven_day_sonnet
        ? normalizeWindow(
            usage.data.seven_day_sonnet,
            { id: "weekly-sonnet", label: "Weekly Sonnet", kind: "model" },
            7 * DAY_MS,
          )
        : undefined,
    ].filter((window): window is QuotaWindow => window !== undefined);

    if (windows.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const account = await accountLabel(injectedFetch, signal);

    return {
      ok: true,
      snapshot: {
        providerId: "claude",
        ...(account ? { accountLabel: account } : {}),
        ...(organization.name ? { planLabel: organization.name } : {}),
        source: "web-session",
        fetchedAt: now,
        windows,
        credits: normalizeCredits(usage.data.extra_usage),
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  capabilities: { browserSession: true },
  optionalOrigins: [CLAUDE_ORIGIN],
  collect: collectClaude,
};
