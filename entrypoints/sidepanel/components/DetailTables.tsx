import React from "react";

import type { DetailTable } from "../../../domain/public-protocol";
import {
  formatDetailCell,
  localizeDetailDescription,
} from "../../../i18n/presentation";
import { l10n } from "../../../i18n/index";

const translate = l10n.t as (
  key: string,
  substitutions?: Record<string, string | number>,
) => string;

function formatCapturedAt(observedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - observedAt) / 60_000));
  const age =
    minutes < 1
      ? l10n.t("freshness.justNow")
      : l10n.count("freshness.minutesAgo", minutes);
  return translate("metrics.detail.captured", { age });
}

export function DetailTables({
  tables,
  now,
}: {
  tables: readonly DetailTable[];
  now: number;
}) {
  if (tables.length === 0) return null;

  return (
    <>
      {tables.map((table) => {
        const headingId = `detail-table-${table.id}`;
        const note = localizeDetailDescription(table.description);
        return (
          <section
            className="detail-table"
            aria-labelledby={headingId}
            key={table.id}
          >
            <div className="detail-table__heading">
              <h2 id={headingId}>{translate(table.labelKey)}</h2>
              <span>{formatCapturedAt(table.observedAt, now)}</span>
            </div>
            {note ? <p>{note}</p> : null}
            {table.rows.length > 0 ? (
              <div className="detail-table__scroll">
                <table>
                  <thead>
                    <tr>
                      {table.columns.map((column) => (
                        <th key={column.key} scope="col">
                          {translate(column.labelKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row) => (
                      <tr key={row.id}>
                        {table.columns.map((column) => {
                          const cell = row.cells[column.key];
                          return (
                            <td
                              key={column.key}
                              className={
                                column.type === "text"
                                  ? "detail-table__text"
                                  : undefined
                              }
                            >
                              {cell === undefined
                                ? "—"
                                : formatDetailCell(column.type, cell)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {table.omittedRowCount ? (
              <p>{l10n.count("metrics.detail.omittedRows", table.omittedRowCount)}</p>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
