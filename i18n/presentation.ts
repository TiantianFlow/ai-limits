import type {
  DetailCellType,
  DisplayMode,
  FailureCategory,
  ProviderKind,
  ProviderOperation,
} from "../domain/public-protocol";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "./format";
import { l10n } from "./index";

const translate = l10n.t as (
  key: string,
  substitutions?: Record<string, string | number>,
) => string;

const GROK_POOL_GROUP_IDS = new Set(["usage-pool", "rate-limits"]);

const KNOWN_METRIC_KEYS: Partial<
  Record<ProviderKind, Record<string, string>>
> = {
  chatgpt: {
    "five-hour": "metrics.chatgpt.fiveHourMessages",
    weekly: "metrics.chatgpt.weeklyMessages",
    credits: "metrics.chatgpt.credits",
  },
  claude: {
    "five-hour": "metrics.claude.fiveHourMessages",
    weekly: "metrics.claude.weeklyMessages",
    "weekly-opus": "metrics.claude.weeklyOpus",
    "weekly-sonnet": "metrics.claude.weeklySonnet",
    "extra-usage": "metrics.claude.extraUsage",
  },
  kimi: {
    "monthly-total": "metrics.kimi.monthlyTotal",
    "five-hour-coding": "metrics.kimi.fiveHourCoding",
    "weekly-coding": "metrics.kimi.weeklyCoding",
  },
  cursor: {
    "cursor-models-monthly": "metrics.cursor.cursorModels",
    "other-models-monthly": "metrics.cursor.otherModels",
    monthly: "metrics.cursor.monthlyUsage",
    "grok-bot-weekly": "metrics.cursor.grokBot",
    "on-demand": "metrics.cursor.onDemandSpend",
    "extra-usage-credits": "metrics.cursor.extraUsageCredits",
  },
  elevenlabs: {
    "monthly-credits": "metrics.elevenlabs.monthlyCredits",
    "voice-slots": "metrics.elevenlabs.voiceSlots",
    "professional-voice-slots": "metrics.elevenlabs.professionalVoiceSlots",
    "voice-add-edits": "metrics.elevenlabs.voiceAddEdits",
  },
  newapi: {
    "relay-key-usage": "metrics.newapi.apiKeyUsage",
    "relay-key-quota": "metrics.newapi.apiKeyQuota",
  },
  litellm: {
    "key-spend": "metrics.litellm.keySpend",
    "key-budget": "metrics.litellm.keyBudget",
    "team-spend": "metrics.litellm.teamSpend",
    "team-budget": "metrics.litellm.teamBudget",
  },
  clawrouter: {
    "monthly-budget": "metrics.clawrouter.monthlyBudget",
    "actual-cost": "metrics.clawrouter.actualCost",
  },
  sub2api: {
    "key-quota": "metrics.sub2api.keyQuota",
    daily: "metrics.sub2api.daily",
    weekly: "metrics.sub2api.weekly",
    monthly: "metrics.sub2api.monthly",
    balance: "metrics.sub2api.balance",
    "rate-5h": "metrics.sub2api.rate5h",
    "rate-1d": "metrics.sub2api.rate1d",
    "rate-7d": "metrics.sub2api.rate7d",
  },
  llmProxy: {
    "remaining-quota": "metrics.llmProxy.remainingQuota",
    "total-requests": "metrics.llmProxy.totalRequests",
    "total-tokens": "metrics.llmProxy.totalTokens",
  },
  grok: {
    "weekly-pool": "metrics.grok.weeklyPool",
    "monthly-pool": "metrics.grok.monthlyPool",
    "extra-usage-credits": "metrics.grok.extraUsageCredits",
  },
};

const KNOWN_GROUP_KEYS: Record<string, string> = {
  usage: "metrics.groups.usage",
  "usage-pool": "metrics.groups.usagePool",
  "rate-limits": "metrics.groups.rateLimits",
};

const KNOWN_SEGMENT_KEYS: Partial<
  Record<ProviderKind, Record<string, string>>
> = {
  kimi: {
    work: "metrics.kimi.work",
    code: "metrics.kimi.code",
  },
  grok: {
    "grok-build": "metrics.grok.grokBuild",
    chat: "metrics.grok.chat",
  },
};

const PLAN_KEYS: Partial<Record<ProviderKind, Record<string, string>>> = {
  chatgpt: { plus: "providers.chatgpt.plans.plus" },
  cursor: { ultra: "providers.cursor.plans.ultra" },
  elevenlabs: { free: "providers.elevenlabs.plans.free" },
  grok: {
    free: "providers.grok.plans.free",
    supergrok: "providers.grok.plans.superGrok",
    "supergrok heavy": "providers.grok.plans.heavy",
    "supergrok plus": "providers.grok.plans.plus",
    "supergrok lite": "providers.grok.plans.lite",
  },
};

const FAILURE_KEYS: Record<FailureCategory, string> = {
  signed_out: "errors.signedOut",
  credential_invalid: "errors.credentialInvalid",
  credential_scope_required: "errors.credentialScopeRequired",
  challenge_blocked: "errors.challengeBlocked",
  provider_changed: "errors.providerChanged",
  temporary_error: "errors.temporaryError",
};

const OPERATION_KEYS: Record<ProviderOperation, string> = {
  requesting_permission: "connections.requestingPermission",
  fetching: "connections.fetchingUsage",
  waiting_for_session: "connections.waitingForKimi",
};

const CAPABILITY_IDS: Record<ProviderKind, readonly string[]> = {
  chatgpt: ["messageLimits", "credits"],
  claude: ["messageLimits", "extraUsage"],
  kimi: ["subscriptionUsage", "codingLimits"],
  cursor: ["monthlyUsage", "grokBotUsage", "onDemandSpend", "extraUsageCredits"],
  grok: ["usagePool", "planTier"],
  elevenlabs: ["monthlyCredits", "voiceLimits"],
  newapi: ["apiKeyQuota", "unlimitedKeyUsage"],
  litellm: ["keySpend", "keyBudget"],
  clawrouter: ["monthlyBudget", "actualCost"],
  sub2api: ["keyQuota", "subscriptionLimits", "balance"],
  llmProxy: ["remainingQuota", "usageCounters"],
};

const DURATION_METRIC = /^(\d+(?:\.\d+)?)-(day|hour)$/;
const GROK_WINDOW =
  /^(?:weekly|(\d+(?:\.\d+)?)-day|(\d+(?:\.\d+)?)-hour)-(.+)-(queries|tokens)$/;
const CLAUDE_SCOPED = /^weekly-scoped-(.+)$/;

function i18nNamed(
  key: string,
  params: Record<string, string | number>,
): string {
  return translate(key, params);
}

export function localizeDisplayMode(mode: DisplayMode): string {
  return l10n.t(mode === "used" ? "common.used" : "common.left");
}

export function localizeDisplayModeCompact(mode: DisplayMode): string {
  return l10n.t(mode === "used" ? "common.usedCompact" : "common.leftCompact");
}

export function localizeProviderName(providerKind: ProviderKind): string {
  return translate(`providers.${providerKind}.name`);
}

export function localizeConnectLabel(providerKind: ProviderKind): string {
  return translate(`providers.${providerKind}.connect`);
}

export function localizeConnectionDisclosure(providerKind: ProviderKind): string {
  return translate(`providers.${providerKind}.connectionDisclosure`);
}

export function localizeManualRefreshDisclosure(
  providerKind: ProviderKind,
): string | undefined {
  if (providerKind !== "kimi" && providerKind !== "cursor") {
    return undefined;
  }
  return translate(`providers.${providerKind}.manualRefreshDisclosure`);
}

export function providerCapabilityIds(
  providerKind: ProviderKind,
): readonly string[] {
  return CAPABILITY_IDS[providerKind];
}

export function localizeCapability(
  providerKind: ProviderKind,
  capabilityId: string,
): string {
  return translate(
    `providers.${providerKind}.capabilities.${capabilityId}`,
  );
}

export function localizePlanLabel(
  providerKind: ProviderKind,
  rawPlanLabel: string | undefined,
): string | undefined {
  if (rawPlanLabel === undefined) {
    return undefined;
  }
  const key = PLAN_KEYS[providerKind]?.[rawPlanLabel.toLowerCase()];
  return key ? translate(key) : rawPlanLabel;
}

export function localizeFailure(category: FailureCategory): string {
  return translate(FAILURE_KEYS[category]);
}

export function localizeRecoveryGuidance(providerKind: ProviderKind): string {
  return providerKind === "kimi"
    ? l10n.t("errors.kimiRetrySession")
    : localizeFailure("temporary_error");
}

export function localizeOperation(operation: ProviderOperation): string {
  return translate(OPERATION_KEYS[operation]);
}

export function localizeMetricLabel(
  providerKind: ProviderKind,
  metric: { id: string; label: string },
): string {
  const known = KNOWN_METRIC_KEYS[providerKind]?.[metric.id];
  if (known) {
    return translate(known);
  }

  if (providerKind === "chatgpt") {
    const duration = metric.id.match(DURATION_METRIC);
    if (duration) {
      const key =
        duration[2] === "day"
          ? "metrics.chatgpt.nDayMessages"
          : "metrics.chatgpt.nHourMessages";
      return i18nNamed(key, { count: duration[1]! });
    }
  }

  if (providerKind === "claude" && CLAUDE_SCOPED.test(metric.id)) {
    const model = metric.label.replace(/^Weekly\s+/i, "").trim() || metric.id;
    return i18nNamed("metrics.claude.weeklyModel", { model });
  }

  if (providerKind === "grok") {
    const window = metric.id.match(GROK_WINDOW);
    if (window) {
      const kind = translate(
        window[4] === "tokens" ? "metrics.grok.tokens" : "metrics.grok.queries",
      );
      const mode = window[3]!;
      if (metric.id.startsWith("weekly-")) {
        return i18nNamed("metrics.grok.weeklyKind", { mode, kind });
      }
      if (window[1]) {
        return i18nNamed("metrics.grok.nDayKind", {
          count: window[1],
          mode,
          kind,
        });
      }
      if (window[2]) {
        return i18nNamed("metrics.grok.nHourKind", {
          count: window[2],
          mode,
          kind,
        });
      }
    }
  }

  return metric.label;
}

export function localizeGroupLabel(
  _providerKind: ProviderKind,
  group: { id: string; label: string },
): string {
  const known = KNOWN_GROUP_KEYS[group.id];
  return known ? translate(known) : group.label;
}

const CURSOR_PAGE_REASON_PREFIX = "cursor:";
const CURSOR_PAGE_CARRIED_PREFIX = "cursor:carried:";

function localizeCursorPageReason(token: string): string | undefined {
  const http = token.match(/^http:(\d{3})$/);
  if (http) {
    return i18nNamed("metrics.cursor.pageHttp", { status: http[1]! });
  }
  const wrongOrigin = token.match(/^wrong-origin:(.+)$/);
  if (wrongOrigin) {
    return i18nNamed("metrics.cursor.pageWrongOrigin", {
      origin: wrongOrigin[1]!,
    });
  }
  const injectThrew = token.match(/^inject-threw:(.+)$/);
  if (injectThrew) {
    return i18nNamed("metrics.cursor.pageInjectThrew", {
      detail: injectThrew[1]!,
    });
  }
  const injectEmpty = token.match(/^inject-empty:(.+)$/);
  if (injectEmpty) {
    return i18nNamed("metrics.cursor.pageInjectEmpty", {
      detail: injectEmpty[1]!,
    });
  }
  const injectUnusable = token.match(/^inject-unusable:(.+)$/);
  if (injectUnusable) {
    return i18nNamed("metrics.cursor.pageInjectUnusable", {
      detail: injectUnusable[1]!,
    });
  }
  switch (token) {
    case "scheduled":
      return l10n.t("metrics.cursor.pageScheduled");
    case "no-tab":
      return l10n.t("metrics.cursor.pageNoTab");
    case "permission":
      return translate("metrics.cursor.pagePermission");
    case "tab-asleep":
      return translate("metrics.cursor.pageTabAsleep");
    case "injection":
      return translate("metrics.cursor.pageInjection");
    case "network":
      return l10n.t("metrics.cursor.pageNetwork");
    case "mismatch":
      return l10n.t("metrics.cursor.pageMismatch");
    case "unavailable":
      return l10n.t("metrics.cursor.pageUnavailable");
    default:
      return undefined;
  }
}

function localizeCursorUsageDescription(
  description: string | undefined,
): string | undefined {
  if (description === undefined || !description.startsWith(CURSOR_PAGE_REASON_PREFIX)) {
    return undefined;
  }
  const carried = description.startsWith(CURSOR_PAGE_CARRIED_PREFIX);
  const reasonToken = carried
    ? description.slice(CURSOR_PAGE_CARRIED_PREFIX.length)
    : description.slice(CURSOR_PAGE_REASON_PREFIX.length);
  const reason = localizeCursorPageReason(reasonToken);
  if (reason === undefined) return undefined;
  return carried
    ? l10n.t("metrics.cursor.pageCarried", { reason })
    : reason;
}

export function localizeGroupDescription(
  providerKind: ProviderKind,
  group: { id: string; description?: string },
): string | undefined {
  if (providerKind === "grok" && GROK_POOL_GROUP_IDS.has(group.id)) {
    return group.description
      ? l10n.t("metrics.grokPoolUnavailable")
      : undefined;
  }
  if (providerKind === "cursor") {
    return localizeCursorUsageDescription(group.description);
  }
  return group.description;
}

export function localizeDetailDescription(
  description: string | undefined,
): string | undefined {
  if (
    description === undefined ||
    !description.startsWith("cursor-detail:")
  ) {
    return undefined;
  }
  const carried = description.startsWith("cursor-detail:carried:");
  const reasonToken = carried
    ? description.slice("cursor-detail:carried:".length)
    : description.slice("cursor-detail:".length);
  const http = reasonToken.match(/^http:(\d{3})$/);
  const reason = http
    ? i18nNamed("metrics.detail.http", { status: http[1]! })
    : reasonToken === "scheduled"
      ? translate("metrics.detail.scheduled")
      : reasonToken === "no-tab"
        ? translate("metrics.detail.noTab")
        : reasonToken === "permission"
          ? translate("metrics.detail.permission")
        : reasonToken === "tab-asleep"
          ? translate("metrics.detail.tabAsleep")
        : reasonToken.startsWith("wrong-origin:")
          ? i18nNamed("metrics.detail.wrongOrigin", {
              origin: reasonToken.slice("wrong-origin:".length),
            })
        : reasonToken.startsWith("inject-threw:")
          ? i18nNamed("metrics.detail.injectThrew", {
              detail: reasonToken.slice("inject-threw:".length),
            })
        : reasonToken.startsWith("inject-empty:")
          ? i18nNamed("metrics.detail.injectEmpty", {
              detail: reasonToken.slice("inject-empty:".length),
            })
        : reasonToken.startsWith("inject-unusable:")
          ? i18nNamed("metrics.detail.injectUnusable", {
              detail: reasonToken.slice("inject-unusable:".length),
            })
        : reasonToken === "injection"
          ? translate("metrics.detail.injection")
          : reasonToken === "network"
          ? translate("metrics.detail.network")
          : reasonToken === "mismatch"
            ? translate("metrics.detail.mismatch")
            : undefined;
  if (reason === undefined) return undefined;
  return carried ? i18nNamed("metrics.detail.carried", { reason }) : reason;
}

export function formatDetailCell(
  type: DetailCellType,
  value: string | number,
): string {
  if (type === "text" || typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }
  if (type === "tokens") {
    return formatNumber(value, { maximumFractionDigits: 0 });
  }
  if (type === "percent") {
    return `${formatPercent(value)}%`;
  }
  if (type === "money") {
    return formatCurrency(value, "USD");
  }
  return formatDateTime(value);
}

export function localizeSegmentLabel(
  providerKind: ProviderKind,
  segment: { id: string; label: string },
): string {
  const known = KNOWN_SEGMENT_KEYS[providerKind]?.[segment.id];
  return known ? translate(known) : segment.label;
}

export function localizeMetricScope(
  scope: "general" | "model" | "feature" | "product",
): string {
  return translate(`metrics.scope.${scope}`);
}

export function localizeCounterValue(
  value: string,
  semantic: "consumed" | "spent",
): string {
  return semantic === "spent"
    ? i18nNamed("quota.spent", { amount: value })
    : i18nNamed("quota.used", { amount: value });
}

export function localizeBalanceValue(value: string): string {
  return i18nNamed("quota.remaining", { amount: value });
}

export function localizeQuotaValue(shown: number, limit: number): string {
  const shownText = formatNumber(shown, { maximumFractionDigits: 2 });
  const limitText = formatNumber(limit, { maximumFractionDigits: 2 });
  return i18nNamed("quota.valuePair", { shown: shownText, limit: limitText });
}
