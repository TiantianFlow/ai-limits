import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DetailTable } from "../../../domain/public-protocol";
import { installI18nLocale } from "../../../test/i18n-harness";
import { DetailTables } from "./DetailTables";

afterEach(() => {
  cleanup();
  installI18nLocale("en");
});

const NOW = Date.parse("2030-04-01T12:00:00.000Z");

const cursorTable: DetailTable = {
  id: "cursor-models",
  labelKey: "metrics.cursor.cursorModels",
  observedAt: NOW - 5 * 60 * 1_000,
  omittedRowCount: 2,
  columns: [
    { key: "model", labelKey: "metrics.detail.model", type: "text" },
    { key: "tokens", labelKey: "metrics.detail.tokens", type: "tokens" },
    { key: "percent", labelKey: "metrics.detail.percent", type: "percent" },
  ],
  rows: [
    {
      id: "composer",
      cells: { model: "composer-1.5", tokens: 12_000, percent: 40 },
    },
  ],
};

const eventTable: DetailTable = {
  id: "kimi-shaped",
  labelKey: "metrics.detail.includedUsage",
  observedAt: NOW,
  description: "cursor-detail:no-tab",
  columns: [
    { key: "event", labelKey: "metrics.detail.event", type: "text" },
    { key: "when", labelKey: "metrics.detail.time", type: "timestamp" },
    { key: "amount", labelKey: "metrics.detail.amount", type: "money" },
  ],
  rows: [
    {
      id: "evt-1",
      cells: { event: "code", when: NOW, amount: 1.5 },
    },
  ],
};

describe("DetailTables", () => {
  it("formats provider-declared columns without assuming a Cursor shape", () => {
    render(<DetailTables tables={[cursorTable, eventTable]} now={NOW} />);

    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tokens" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("composer-1.5")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("2 more rows not shown")).toBeInTheDocument();

    expect(screen.getByRole("columnheader", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open cursor.com, then Refresh, to update included usage.",
      ),
    ).toBeInTheDocument();
  });

  it("shows captured time and does not render a silent empty section", () => {
    const empty: DetailTable = {
      id: "included-usage",
      labelKey: "metrics.detail.includedUsage",
      observedAt: NOW - 60_000,
      description: "cursor-detail:scheduled",
      columns: cursorTable.columns,
      rows: [],
    };
    render(<DetailTables tables={[empty]} now={NOW} />);
    expect(screen.getByText("Included usage")).toBeInTheDocument();
    expect(screen.getByText("Captured 1 minute ago")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Included usage updates on Connect or Refresh with an open cursor.com tab.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
