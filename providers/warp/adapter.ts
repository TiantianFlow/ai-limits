import type {
  BalanceMetric,
  CounterMetric,
  MetricCycle,
  ProviderHealth,
  QuotaMetric,
  UsageMetric,
  UsageSnapshot,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  warpBonusGrantSchema,
  warpRequestLimitInfoSchema,
  warpRequestLimitResponseSchema,
  type WarpBonusGrant,
  type WarpRequestLimitInfo,
} from "./schema";

const API_ORIGIN = "https://app.warp.dev";
const OPERATION = "GetRequestLimitInfo";
const GRAPHQL_URL = `${API_ORIGIN}/graphql/v2?op=${OPERATION}`;

// The same read-only query Warp's open-source client sends, trimmed to the
// fields AI Limits shows. Grant costs, reasons, and messages are not requested.
const QUERY = `query GetRequestLimitInfo($requestContext: RequestContext!) {
  user(requestContext: $requestContext) {
    __typename
    ... on UserOutput {
      user {
        requestLimitInfo {
          isUnlimited
          requestLimit
          requestsUsedSinceLastRefresh
          nextRefreshTime
          requestLimitRefreshDuration
        }
        bonusGrants {
          grantType
          requestCreditsGranted
          requestCreditsRemaining
          expiration
        }
        workspaces {
          bonusGrantsInfo {
            grants {
              grantType
              requestCreditsGranted
              requestCreditsRemaining
              expiration
            }
          }
        }
      }
    }
    ... on UserFacingError {
      error {
        message
      }
    }
  }
}`;

const DAY_MS = 24 * 60 * 60 * 1_000;
const REFRESH_DURATION_MS: Record<string, number> = {
  WEEKLY: 7 * DAY_MS,
  EVERY_TWO_WEEKS: 14 * DAY_MS,
};

// Warp reports some authentication failures as GraphQL errors on HTTP 200.
const AUTH_ERROR =
  /unauthori[sz]ed|unauthenticated|not authenticated|invalid (?:api )?(?:key|token)|(?:api key|token|session) (?:has )?expired/i;

function requestBody(): string {
  // OS and client fields are optional; none are claimed for a browser caller.
  return JSON.stringify({
    query: QUERY,
    variables: { requestContext: { clientContext: {}, osContext: {} } },
    operationName: OPERATION,
  });
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401 || response.status === 403) {
    return { kind: "credential_invalid" };
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

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function healthForErrors(messages: string[]): ProviderHealth {
  return messages.some((message) => AUTH_ERROR.test(message))
    ? { kind: "credential_invalid" }
    : { kind: "provider_changed" };
}

function timestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function previousMonthBoundary(resetsAt: number): number | undefined {
  const reset = new Date(resetsAt);
  const year = reset.getUTCMonth() === 0
    ? reset.getUTCFullYear() - 1
    : reset.getUTCFullYear();
  const month = reset.getUTCMonth() === 0 ? 11 : reset.getUTCMonth() - 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const boundary = Date.UTC(
    year,
    month,
    Math.min(reset.getUTCDate(), lastDay),
    reset.getUTCHours(),
    reset.getUTCMinutes(),
    reset.getUTCSeconds(),
    reset.getUTCMilliseconds(),
  );
  return Number.isFinite(boundary) && boundary < resetsAt ? boundary : undefined;
}

function includedCycle(info: WarpRequestLimitInfo, now: number): MetricCycle {
  const resetsAt = timestamp(info.nextRefreshTime);
  if (resetsAt === undefined || resetsAt <= now) return { cadence: "calendar" };

  const duration = info.requestLimitRefreshDuration ?? "";
  const fixedMs = REFRESH_DURATION_MS[duration];
  const startedAt =
    fixedMs !== undefined
      ? resetsAt - fixedMs
      : duration === "MONTHLY"
        ? previousMonthBoundary(resetsAt)
        : undefined;
  // A start in the future means the reported cycle does not match the cadence.
  if (startedAt === undefined || startedAt > now) {
    return { cadence: "calendar", resetsAt };
  }
  return {
    cadence: "calendar",
    startedAt,
    resetsAt,
    durationMs: resetsAt - startedAt,
  };
}

function nonNegative(value: number): number {
  return Math.max(0, value);
}

function includedMetric(
  info: WarpRequestLimitInfo,
  now: number,
): QuotaMetric | CounterMetric {
  const identity = {
    id: "included",
    label: "Included credits",
    scope: "general",
  } as const;
  // Like Warp's client, treat a passed refresh time as a fresh allowance
  // until the server reports the new period.
  const refreshedAt = timestamp(info.nextRefreshTime);
  const used =
    refreshedAt !== undefined && refreshedAt <= now
      ? 0
      : nonNegative(info.requestsUsedSinceLastRefresh);
  const cycle = includedCycle(info, now);
  // Unlimited plans and plans without included credits have no ratio to show.
  if (info.isUnlimited || info.requestLimit <= 0) {
    return {
      ...identity,
      type: "counter",
      semantic: "consumed",
      value: used,
      unit: "credits",
      cycle,
    };
  }
  const limit = info.requestLimit;
  const clampedUsed = Math.min(limit, used);
  return {
    ...identity,
    type: "quota",
    usedRatio: clampedUsed / limit,
    used: clampedUsed,
    limit,
    unit: "credits",
    cycle,
  };
}

function parsedGrants(values: unknown[] | null | undefined): WarpBonusGrant[] {
  return (values ?? []).flatMap((value) => {
    const parsed = warpBonusGrantSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function addOnBalance(
  grants: WarpBonusGrant[],
  now: number,
): BalanceMetric | undefined {
  const active = grants.filter((grant) => {
    // Ambient-only grants pay only for Warp's background agent runs.
    if (grant.grantType === "AMBIENT_ONLY") return false;
    const expiresAt = timestamp(grant.expiration);
    return expiresAt === undefined || expiresAt > now;
  });
  const remaining = active.reduce(
    (sum, grant) => sum + nonNegative(grant.requestCreditsRemaining),
    0,
  );
  // A spent balance is hidden on pool-primary cards, so it is not reported.
  if (remaining <= 0) return undefined;
  const granted = active.reduce(
    (sum, grant) => sum + nonNegative(grant.requestCreditsGranted),
    0,
  );
  return {
    type: "balance",
    id: "add-on",
    label: "Add-on credits",
    scope: "product",
    value: remaining,
    unit: "credits",
    ...(granted >= remaining && granted > 0 ? { initialLimit: granted } : {}),
  };
}

function snapshotFromBody(
  body: unknown,
  now: number,
): { snapshot: UsageSnapshot } | { health: ProviderHealth } {
  const parsed = warpRequestLimitResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { health: { kind: "provider_changed" } };
  }
  const errors = parsed.data.errors ?? [];
  if (errors.length > 0) {
    return { health: healthForErrors(errors.map(errorMessage)) };
  }
  const result = parsed.data.data?.user;
  if (result?.error) {
    return { health: healthForErrors([result.error.message ?? ""]) };
  }
  const user = result?.user;
  const info = warpRequestLimitInfoSchema.safeParse(user?.requestLimitInfo);
  if (!user || !info.success) {
    return { health: { kind: "provider_changed" } };
  }

  const grants = [
    ...parsedGrants(user.bonusGrants),
    ...(user.workspaces ?? []).flatMap((workspace) =>
      parsedGrants(workspace.bonusGrantsInfo?.grants),
    ),
  ];
  const included = includedMetric(info.data, now);
  const addOn = addOnBalance(grants, now);
  const metrics: UsageMetric[] = addOn ? [included, addOn] : [included];

  return {
    snapshot: {
      providerKind: "warp",
      source: "api-key",
      fetchedAt: now,
      metrics,
      usageGroups: [
        { id: "usage", label: "Usage", metricIds: [included.id] },
        ...(addOn
          ? [{ id: "credits", label: "Credits", metricIds: [addOn.id] }]
          : []),
      ],
    },
  };
}

async function collectWarp({
  credential,
  fetch,
  now,
  signal,
}: CollectionContext): Promise<CollectionResult> {
  const apiKey =
    credential?.kind === "api-key" ? credential.value.trim() : "";
  if (!apiKey) {
    return { ok: false, health: { kind: "signed_out" } };
  }

  let response: Response;
  try {
    response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: requestHeaders(apiKey),
      body: requestBody(),
      signal,
    });
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }

  if (!response.ok) {
    return { ok: false, health: healthForResponse(response, now) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, health: { kind: "provider_changed" } };
  }

  const result = snapshotFromBody(body, now);
  return "snapshot" in result
    ? { ok: true, snapshot: result.snapshot }
    : { ok: false, health: result.health };
}

export const warpAdapter: ProviderCollector<"warp"> = {
  id: "warp",
  collect: collectWarp,
};
