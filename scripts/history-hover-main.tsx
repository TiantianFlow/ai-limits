import React from "react";
import { createRoot } from "react-dom/client";
import { generateChromeMessages, parseMessagesText, type ParsedMessage } from "@wxt-dev/i18n/build";

import enSource from "../locales/en.yml?raw";

const parsed = parseMessagesText(enSource, "YAML");
const messages = generateChromeMessages(parsed);

function templateOf(message: ParsedMessage): string {
  if (message.type === "plural") return message.plurals.other ?? message.plurals.n ?? "";
  return message.message;
}

const templates = new Map(parsed.map((message) => [message.key.join("."), templateOf(message)]));
Object.assign(globalThis, {
  browser: {
    i18n: {
      getMessage(key: string, substitutions?: string | string[]): string {
        void substitutions;
        const dotted = key.replaceAll("_", ".");
        return templates.get(dotted) ?? messages[key]?.message ?? "";
      },
    },
    runtime: { getURL: (value: string) => value },
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
});

import { HistoryChart } from "../entrypoints/sidepanel/components/HistoryChart";
import "../entrypoints/sidepanel/styles.css";
import { FIXTURE_NOW, REALISTIC_METERS, idleGrid } from "../domain/history-realistic";
import type { QuotaMetric } from "../domain/model";

const DAY = 24 * 60 * 60 * 1_000;

const meter = REALISTIC_METERS.find((item) => item.providerKind === "claude" && item.metricId === "weekly");
if (!meter) throw new Error("The weekly fixture is missing");

const metric: QuotaMetric = {
  type: "quota",
  id: meter.metricId,
  label: meter.label,
  scope: "general",
  usedRatio: 0.2,
  cycle: { cadence: "rolling", durationMs: 7 * DAY, resetsAt: FIXTURE_NOW + 7 * DAY },
};

const HOUR = 60 * 60 * 1_000;
const kimiHistory = idleGrid({
  metricId: "five-hour-coding",
  windowMs: 5 * HOUR,
  now: FIXTURE_NOW,
  anchor: FIXTURE_NOW - 46 * HOUR,
});
const kimiMetric: QuotaMetric = {
  type: "quota",
  id: "five-hour-coding",
  label: "5-hour usage",
  scope: "general",
  usedRatio: 0,
  cycle: { cadence: "rolling", durationMs: 5 * HOUR, resetsAt: FIXTURE_NOW + 5 * HOUR },
};

const widths = [340, 400, 460];

function Page(): React.ReactElement {
  return (
    <main data-ready="1" style={{ display: "grid", gap: 16, padding: 16 }}>
      {widths.map((width) => (
        <section
          key={width}
          data-width={width}
          className="history-surface"
          style={{ width, padding: 12, background: "white", color: "black" }}
        >
          <HistoryChart
            providerName={meter!.providerName}
            providerKind={meter!.providerKind}
            mode="used"
            metrics={[metric]}
            history={meter!.history}
            now={FIXTURE_NOW}
            rangeHours={30 * 24}
          />
        </section>
      ))}
      {widths.map((width) => (
        <section
          key={`kimi-${width}`}
          data-kimi={width}
          className="history-surface"
          style={{ width, padding: 12, background: "white", color: "black" }}
        >
          <HistoryChart
            providerName="Kimi"
            providerKind="kimi"
            mode="used"
            metrics={[kimiMetric]}
            history={kimiHistory}
            now={FIXTURE_NOW}
            rangeHours={48}
          />
        </section>
      ))}
    </main>
  );
}

document.documentElement.dataset.theme = "light";
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(<Page />);
