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
import { retryAtFromResponse } from "../retry-after";
import {
  claudeExtraUsageSchema,
  claudeOrganizationListSchema,
  claudeOrganizationSchema,
  claudeScopedLimitSchema,
  claudeUsageSchema,
  claudeUsageWindowSchema,
  type ClaudeExtraUsage,
  type ClaudeOrganization,
  type ClaudeScopedLimit,
  type ClaudeUsageWindow,
} from "./schema";

const ORGANIZATIONS_ENDPOINT = "https://claude.ai/api/organizations";
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

const REQUEST_INIT = {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
} as const;

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401) {
    return { kind: "signed_out" };
  }

  if (response.status === 429 || response.status >= 500) {
    const retryAt = retryAtFromResponse(response, now);
    return {
      kind: "temporary_error",
      ...(retryAt === undefined ? {} : { retryAt }),
    };
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
  if (window.resets_at === null) {
    throw new Error("Cannot normalize a window without a reset time");
  }

  return {
    ...identity,
    usedRatio: window.utilization / 100,
    resetsAt: Date.parse(window.resets_at),
    durationMs,
    sourceSemantics: "used",
  };
}

function scopedWindowId(displayName: string): string {
  const sanitizedName = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `weekly-scoped-${sanitizedName}`;
}

function normalizeScopedWindow(limit: ClaudeScopedLimit): QuotaWindow {
  const displayName = limit.scope.model.display_name;
  return {
    id: scopedWindowId(displayName),
    label: `Weekly ${displayName}`,
    kind: "model",
    usedRatio: limit.percent / 100,
    resetsAt: Date.parse(limit.resets_at),
    durationMs: 7 * DAY_MS,
    sourceSemantics: "used",
  };
}

function normalizeCredits(
  extraUsage: ClaudeExtraUsage,
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
        health: healthForResponse(organizationsResponse, now),
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
      return { ok: false, health: healthForResponse(usageResponse, now) };
    }

    const usage = claudeUsageSchema.safeParse(await parseJson(usageResponse));
    if (!usage.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const optionalModelWindows = [
      {
        value: usage.data.seven_day_opus,
        id: "weekly-opus",
        label: "Weekly Opus",
      },
      {
        value: usage.data.seven_day_sonnet,
        id: "weekly-sonnet",
        label: "Weekly Sonnet",
      },
    ].flatMap((candidate) => {
      const parsed = claudeUsageWindowSchema.safeParse(candidate.value);
      return parsed.success
        ? [{ ...candidate, value: parsed.data }]
        : [];
    });
    const namedUsageWindows = [
      usage.data.five_hour,
      usage.data.seven_day,
      ...optionalModelWindows.map((candidate) => candidate.value),
    ];
    if (
      namedUsageWindows.some(
        (window) => window?.utilization && window.resets_at === null,
      )
    ) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const namedWindows = [
      usage.data.five_hour?.resets_at
        ? normalizeWindow(
            usage.data.five_hour,
            { id: "five-hour", label: "5-hour messages", kind: "rolling" },
            5 * HOUR_MS,
          )
        : undefined,
      usage.data.seven_day?.resets_at
        ? normalizeWindow(
            usage.data.seven_day,
            { id: "weekly", label: "Weekly messages", kind: "rolling" },
            7 * DAY_MS,
          )
        : undefined,
      ...optionalModelWindows.map((candidate) =>
        candidate.value.resets_at
          ? normalizeWindow(
              candidate.value,
              { id: candidate.id, label: candidate.label, kind: "model" },
              7 * DAY_MS,
            )
          : undefined,
      ),
    ].filter((window): window is QuotaWindow => window !== undefined);

    const scopedWindows = (usage.data.limits ?? []).flatMap((candidate) => {
      const parsed = claudeScopedLimitSchema.safeParse(candidate);
      return parsed.success ? [normalizeScopedWindow(parsed.data)] : [];
    });
    if (
      new Set(scopedWindows.map((window) => window.id)).size !==
      scopedWindows.length
    ) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const windows = [...namedWindows, ...scopedWindows];

    if (windows.length === 0) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const extraUsage = claudeExtraUsageSchema.safeParse(usage.data.extra_usage);
    return {
      ok: true,
      snapshot: {
        providerId: "claude",
        ...(organization.name ? { planLabel: organization.name } : {}),
        source: "web-session",
        fetchedAt: now,
        windows,
        credits: extraUsage.success ? normalizeCredits(extraUsage.data) : [],
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const claudeAdapter: ProviderAdapter<"claude"> = {
  id: "claude",
  collect: collectClaude,
};
