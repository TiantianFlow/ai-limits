import React from "react";
import { createRoot } from "react-dom/client";

import "./setup";

import { BalanceHistoryChart } from "../../../entrypoints/sidepanel/components/BalanceHistoryChart";
import "../../../entrypoints/sidepanel/styles.css";
import type { BalanceMetric, UsageHistoryObservation } from "../../../domain/model";

/**
 * Synthetic prepaid balance over 30 days of hourly readings: steady daytime
 * spend, one $20 top-up, and a 10-hour stretch with no readings.
 */
const HOUR = 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 9, 18, 12);
const RANGE_HOURS = 30 * 24;
const TOP_UP_HOURS_AGO = 400;
const GAP_HOURS_AGO = [480, 470] as const;

const history: UsageHistoryObservation[] = [];
let value = 20;
for (let hoursAgo = RANGE_HOURS; hoursAgo >= 0; hoursAgo -= 1) {
  if (hoursAgo > GAP_HOURS_AGO[1] && hoursAgo < GAP_HOURS_AGO[0]) continue;
  // The top-up reading carries no spend, so its rise is exactly $20.
  value = hoursAgo === TOP_UP_HOURS_AGO
    ? value + 20
    : Math.round((value - (hoursAgo % 24 > 8 ? 0.06 : 0.01)) * 100) / 100;
  history.push({
    observedAt: NOW - hoursAgo * HOUR,
    metrics: [{ type: "balance", metricId: "balance", value, unit: "USD" }],
  });
}
const first = history[0]!.metrics[0]!;
const net = value - (first.type === "balance" ? first.value : 0);

const metric: BalanceMetric = {
  type: "balance",
  id: "balance",
  label: "Balance",
  scope: "general",
  value,
  unit: "USD",
};

const widths = [340, 400, 460];

function Page(): React.ReactElement {
  return (
    <main
      data-ready="1"
      data-range-start={NOW - RANGE_HOURS * HOUR}
      data-range-end={NOW}
      data-topup-at={NOW - TOP_UP_HOURS_AGO * HOUR}
      data-gap-at={NOW - ((GAP_HOURS_AGO[0] + GAP_HOURS_AGO[1]) / 2) * HOUR}
      data-net={net.toFixed(2)}
      style={{ display: "grid", gap: 16, padding: 16 }}
    >
      {widths.map((width) => (
        <section
          key={width}
          data-width={width}
          className="history-surface"
          style={{ width, padding: 12, background: "white", color: "black" }}
        >
          <BalanceHistoryChart
            providerName="DeepSeek"
            metric={metric}
            history={history}
            now={NOW}
            rangeHours={RANGE_HOURS}
          />
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
