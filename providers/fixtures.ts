import type { AppState, ProviderRecord, ProviderSnapshot } from "../domain/model";
import { observationFromSnapshot } from "../domain/history";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function fixtureSnapshot(
  snapshot: Omit<ProviderSnapshot, "source" | "fetchedAt">,
  now: number,
): ProviderSnapshot {
  return {
    ...snapshot,
    source: "fixture",
    fetchedAt: now,
  };
}

function fixtureHistory(snapshot: ProviderSnapshot) {
  const current = observationFromSnapshot(snapshot);
  return [
    {
      observedAt: snapshot.fetchedAt - HOUR,
      windows: current.windows.map((window) => ({
        ...window,
        usedRatio: Math.max(0, window.usedRatio - 0.18),
      })),
    },
    {
      observedAt: snapshot.fetchedAt - 30 * 60 * 1_000,
      windows: current.windows.map((window) => ({
        ...window,
        usedRatio: Math.max(0, window.usedRatio - 0.08),
      })),
    },
    current,
  ];
}

export function createFixtureState(now: number): AppState {
  const fiveHours = 5 * HOUR;
  const week = 7 * DAY;
  const fixtureDate = new Date(now);
  const calendarMonthStartedAt = Date.UTC(
    fixtureDate.getUTCFullYear(),
    fixtureDate.getUTCMonth(),
    1,
  );
  const calendarMonthResetsAt = Date.UTC(
    fixtureDate.getUTCFullYear(),
    fixtureDate.getUTCMonth() + 1,
    1,
  );

  const providers: ProviderRecord[] = [
    {
      providerId: "chatgpt",
      access: "granted",
      history: [],
      snapshot: fixtureSnapshot(
        {
          providerId: "chatgpt",
          accountLabel: "ChatGPT Plus",
          planLabel: "Plus",
          windows: [
            {
              id: "five-hour",
              label: "5-hour messages",
              kind: "rolling",
              usedRatio: 0.72,
              resetsAt: now + 2 * HOUR,
              durationMs: fiveHours,
              sourceSemantics: "used",
            },
            {
              id: "weekly",
              label: "Weekly messages",
              kind: "rolling",
              usedRatio: 0.71,
              startedAt: now - 5 * DAY,
              resetsAt: now + 2 * DAY,
              durationMs: week,
              sourceSemantics: "used",
            },
          ],
          credits: [],
          usageGroups: [
            {
              id: "usage",
              label: "Usage",
              windowIds: ["five-hour", "weekly"],
              creditIds: [],
            },
          ],
        },
        now,
      ),
    },
    {
      providerId: "claude",
      access: "granted",
      history: [],
      snapshot: fixtureSnapshot(
        {
          providerId: "claude",
          accountLabel: "Claude Max",
          planLabel: "Max",
          windows: [
            {
              id: "weekly",
              label: "Weekly usage",
              kind: "rolling",
              usedRatio: 0.67,
              startedAt: now - 5 * DAY,
              resetsAt: now + 2 * DAY,
              durationMs: week,
              sourceSemantics: "used",
            },
          ],
          credits: [
            {
              id: "extra-usage",
              label: "Extra usage",
              unit: "USD",
              used: 8.2,
              limit: 20,
              resetsAt: now + 2 * DAY,
            },
          ],
          usageGroups: [
            {
              id: "usage",
              label: "Usage",
              windowIds: ["weekly"],
              creditIds: ["extra-usage"],
            },
          ],
        },
        now,
      ),
    },
    {
      providerId: "kimi",
      access: "granted",
      history: [],
      snapshot: fixtureSnapshot(
        {
          providerId: "kimi",
          accountLabel: "Kimi Coding Moderato",
          planLabel: "Moderato",
          windows: [
            {
              id: "five-hour",
              label: "5-hour usage",
              kind: "rolling",
              usedRatio: 0.55,
              resetsAt: now + 2 * HOUR,
              durationMs: fiveHours,
              sourceSemantics: "used",
            },
            {
              id: "weekly",
              label: "Weekly usage",
              kind: "rolling",
              usedRatio: 0.22,
              startedAt: now - 5 * DAY,
              resetsAt: now + 2 * DAY,
              durationMs: week,
              sourceSemantics: "used",
            },
          ],
          credits: [],
          usageGroups: [
            {
              id: "usage",
              label: "Usage",
              windowIds: ["five-hour", "weekly"],
              creditIds: [],
            },
          ],
        },
        now,
      ),
    },
    {
      providerId: "cursor",
      access: "granted",
      history: [],
      snapshot: fixtureSnapshot(
        {
          providerId: "cursor",
          accountLabel: "Cursor Pro",
          planLabel: "Pro",
          windows: [
            {
              id: "monthly",
              label: "Monthly usage",
              kind: "calendar",
              usedRatio: 0.78,
              startedAt: calendarMonthStartedAt,
              resetsAt: calendarMonthResetsAt,
              durationMs: calendarMonthResetsAt - calendarMonthStartedAt,
              sourceSemantics: "used",
            },
          ],
          credits: [
            {
              id: "on-demand",
              label: "On-demand spend",
              unit: "USD",
              used: 3.2,
            },
          ],
          usageGroups: [
            {
              id: "usage",
              label: "Usage",
              windowIds: ["monthly"],
              creditIds: ["on-demand"],
            },
          ],
        },
        now,
      ),
    },
  ];

  for (const provider of providers) {
    provider.history = provider.snapshot
      ? fixtureHistory(provider.snapshot)
      : [];
  }

  return {
    version: 4,
    preferences: { displayMode: "used", autoRefresh: true },
    providers,
  };
}
