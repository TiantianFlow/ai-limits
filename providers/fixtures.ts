import { observationFromUsage } from "../domain/history";
import type {
  QuotaMetric,
  UsageSnapshot,
} from "../domain/model";
import type {
  AppViewState,
  ProviderInstanceView,
} from "../domain/public-protocol";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function fixtureSnapshot(
  snapshot: Omit<UsageSnapshot, "source" | "fetchedAt">,
  now: number,
): UsageSnapshot {
  return { ...snapshot, source: "fixture", fetchedAt: now };
}

function fixtureHistory(snapshot: UsageSnapshot) {
  const current = observationFromUsage(snapshot);
  const earlier = (observedAt: number, delta: number) => ({
    observedAt,
    metrics: current.metrics.map((metric) =>
      metric.type === "quota"
        ? { ...metric, usedRatio: Math.max(0, metric.usedRatio - delta) }
        : { ...metric },
    ),
  });
  return [
    earlier(snapshot.fetchedAt - HOUR, 0.18),
    earlier(snapshot.fetchedAt - 30 * 60 * 1_000, 0.08),
    current,
  ];
}

function quota(
  id: string,
  label: string,
  scope: QuotaMetric["scope"],
  usedRatio: number,
  cycle?: QuotaMetric["cycle"],
): QuotaMetric {
  return {
    type: "quota",
    id,
    label,
    scope,
    usedRatio,
    ...(cycle === undefined ? {} : { cycle }),
  };
}

export function createFixtureState(
  now: number,
  options: { includeAccountLabels?: boolean } = {},
): AppViewState {
  const fiveHours = 5 * HOUR;
  const week = 7 * DAY;
  const fixtureDate = new Date(now);
  const monthStart = Date.UTC(fixtureDate.getUTCFullYear(), fixtureDate.getUTCMonth(), 1);
  const monthReset = Date.UTC(fixtureDate.getUTCFullYear(), fixtureDate.getUTCMonth() + 1, 1);
  const rollingFiveHour = { cadence: "rolling" as const, resetsAt: now + 2 * HOUR, durationMs: fiveHours };
  const rollingWeek = { cadence: "rolling" as const, startedAt: now - 5 * DAY, resetsAt: now + 2 * DAY, durationMs: week };
  const calendarMonth = { cadence: "calendar" as const, startedAt: monthStart, resetsAt: monthReset, durationMs: monthReset - monthStart };

  const instances: ProviderInstanceView[] = [
    {
      id: "chatgpt:default",
      providerKind: "chatgpt",
      access: "granted",
      createdAt: now - DAY,
      history: [],
      snapshot: fixtureSnapshot({
        providerKind: "chatgpt",
        accountLabel: "ChatGPT Plus",
        planLabel: "Plus",
        metrics: [
          quota("five-hour", "5-hour messages", "general", 0.72, rollingFiveHour),
          quota("weekly", "Weekly messages", "general", 0.71, rollingWeek),
        ],
        usageGroups: [{ id: "usage", label: "Usage", metricIds: ["five-hour", "weekly"] }],
      }, now),
    },
    {
      id: "claude:default",
      providerKind: "claude",
      access: "granted",
      createdAt: now - DAY,
      history: [],
      snapshot: fixtureSnapshot({
        providerKind: "claude",
        accountLabel: "Claude Max",
        planLabel: "Max",
        metrics: [
          quota("weekly", "Weekly usage", "general", 0.67, rollingWeek),
          { type: "counter", id: "extra-usage", label: "Extra usage", scope: "product", semantic: "spent", value: 8.2, limit: 20, unit: "USD", cycle: rollingWeek },
        ],
        usageGroups: [{ id: "usage", label: "Usage", metricIds: ["weekly", "extra-usage"] }],
      }, now),
    },
    {
      id: "kimi:default",
      providerKind: "kimi",
      access: "granted",
      createdAt: now - DAY,
      history: [],
      snapshot: fixtureSnapshot({
        providerKind: "kimi",
        accountLabel: "Kimi Coding Moderato",
        planLabel: "Moderato",
        metrics: [
          quota("five-hour", "5-hour usage", "general", 0.55, rollingFiveHour),
          quota("weekly", "Weekly usage", "general", 0.22, rollingWeek),
        ],
        usageGroups: [{ id: "usage", label: "Usage", metricIds: ["five-hour", "weekly"] }],
      }, now),
    },
    {
      id: "cursor:default",
      providerKind: "cursor",
      access: "granted",
      createdAt: now - DAY,
      history: [],
      snapshot: fixtureSnapshot({
        providerKind: "cursor",
        accountLabel: "Cursor Pro",
        planLabel: "Pro",
        metrics: [
          quota("monthly", "Monthly usage", "general", 0.78, calendarMonth),
          { type: "counter", id: "on-demand", label: "On-demand spend", scope: "product", semantic: "spent", value: 3.2, unit: "USD" },
        ],
        usageGroups: [{ id: "usage", label: "Usage", metricIds: ["monthly", "on-demand"] }],
      }, now),
    },
    {
      id: "elevenlabs:default",
      providerKind: "elevenlabs",
      access: "granted",
      createdAt: now - DAY,
      history: [],
      snapshot: fixtureSnapshot({
        providerKind: "elevenlabs",
        accountLabel: "ElevenLabs Starter",
        planLabel: "Starter",
        metrics: [
          { ...quota("monthly-credits", "Monthly credits", "product", 0.25, calendarMonth), used: 2_500, limit: 10_000, unit: "credits" },
          { ...quota("voice-slots", "Voice slots", "feature", 0.2), used: 2, limit: 10, unit: "voices" },
          { ...quota("professional-voice-slots", "Professional voice slots", "feature", 1 / 3), used: 1, limit: 3, unit: "voices" },
          { ...quota("voice-add-edits", "Voice add/edits", "feature", 0.2), used: 4, limit: 20, unit: "actions" },
        ],
        usageGroups: [{ id: "usage", label: "Usage", metricIds: ["monthly-credits", "voice-slots", "professional-voice-slots", "voice-add-edits"] }],
      }, now),
    },
    {
      id: "newapi:default",
      providerKind: "newapi",
      userLabel: "Personal relay",
      baseUrl: "https://relay.example/gateway",
      origin: "https://relay.example",
      access: "granted",
      createdAt: now - DAY,
      history: [],
      snapshot: fixtureSnapshot({
        providerKind: "newapi",
        accountLabel: "Example New API",
        planLabel: "AI Limits",
        metrics: [{ ...quota("relay-key-quota", "API key quota", "feature", 0.25), used: 2_500, limit: 10_000, unit: "quota units" }],
        usageGroups: [{ id: "usage", label: "Usage", metricIds: ["relay-key-quota"] }],
      }, now),
    },
  ];

  for (const instance of instances) {
    instance.history = instance.snapshot ? fixtureHistory(instance.snapshot) : [];
    if (instance.snapshot && !options.includeAccountLabels) {
      delete instance.snapshot.accountLabel;
    }
  }

  return {
    preferences: { displayMode: "used", autoRefresh: true },
    instances,
  };
}

export function createEmptyFixtureState(): AppViewState {
  return {
    preferences: { displayMode: "used", autoRefresh: true },
    instances: [],
  };
}
