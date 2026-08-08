import type { AppState, ProviderRecord, ProviderSnapshot } from "../domain/model";

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
      health: { kind: "connected" },
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
        },
        now,
      ),
    },
    {
      providerId: "claude",
      health: { kind: "connected" },
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
        },
        now,
      ),
    },
    {
      providerId: "kimi",
      health: { kind: "connected" },
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
        },
        now,
      ),
    },
    {
      providerId: "cursor",
      health: { kind: "connected" },
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
        },
        now,
      ),
    },
    {
      providerId: "antigravity",
      health: {
        kind: "experimental_unavailable",
        message: "Usage data is not available yet.",
      },
    },
  ];

  return {
    version: 2,
    preferences: { displayMode: "used" },
    providers,
  };
}
