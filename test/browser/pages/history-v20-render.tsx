import React from "react";
import { createRoot } from "react-dom/client";

import "./setup";

import { HistoryChart } from "../../../entrypoints/sidepanel/components/HistoryChart";
import "../../../entrypoints/sidepanel/styles.css";
import { FIXTURE_NOW, REALISTIC_METERS } from "../../../domain/history-realistic";
import type { DisplayMode, QuotaMetric } from "../../../domain/model";

const DAY = 24 * 60 * 60 * 1_000;
const RANGES = [48, 7 * 24, 30 * 24];
const MODES: DisplayMode[] = ["used", "left"];

function metricFor(meter: (typeof REALISTIC_METERS)[number]): QuotaMetric {
  const duration = meter.metricId.includes("five-hour")
    ? 5 * 60 * 60 * 1_000
    : meter.metricId === "30-day" || meter.metricId.includes("monthly")
      ? 30 * DAY
      : 7 * DAY;
  return {
    type: "quota",
    id: meter.metricId,
    label: meter.label,
    scope: "general",
    usedRatio: meter.currentUsedRatio ?? 0,
    cycle: { cadence: "rolling", durationMs: duration, resetsAt: FIXTURE_NOW + duration },
  };
}

function Page(): React.ReactElement {
  return (
    <main data-ready="1">
      {REALISTIC_METERS.map((meter) => RANGES.map((range) => MODES.map((mode) => (
        <section
          key={`${meter.metricId}-${range}-${mode}`}
          data-shot={`${meter.providerKind}-${meter.metricId}-${range}-${mode}`}
          className="history-surface"
          style={{ width: 360, padding: 12 }}
        >
          <p className="history-v20-caption">{meter.providerName} · {meter.label} · {range}h · {mode}</p>
          <HistoryChart
            providerName={meter.providerName}
            providerKind={meter.providerKind}
            mode={mode}
            metrics={[metricFor(meter)]}
            history={meter.history}
            now={FIXTURE_NOW}
            rangeHours={range}
          />
        </section>
      ))))}
    </main>
  );
}

const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.dataset.theme = dark ? "dark" : "light";
document.body.style.margin = "0";
document.body.style.background = dark ? "#111111" : "#f5f5f5";
createRoot(document.getElementById("root")!).render(<Page />);
