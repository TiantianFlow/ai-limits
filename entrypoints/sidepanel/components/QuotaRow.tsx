import React from "react";

import type { DisplayMode } from "../../../domain/model";
import type { PaceKind } from "../../../domain/quota";

export interface QuotaRowProps {
  label: string;
  mode: DisplayMode;
  quotaPercent: number;
  elapsedPercent?: number;
  timeLabel?: string;
  paceKind?: PaceKind;
  paceLabel: string;
}

export function QuotaRow({
  label,
  mode,
  quotaPercent,
  elapsedPercent,
  timeLabel,
  paceKind,
  paceLabel,
}: QuotaRowProps) {
  return (
    <section className="quota-row" role="group" aria-label={label}>
      <div className="quota-row__heading">
        <h3>{label}</h3>
        <span className="quota-row__value">
          {quotaPercent}% {mode}
        </span>
      </div>
      <div
        className="progress progress--quota"
        role="progressbar"
        aria-label={`${label} quota ${mode}`}
        aria-valuenow={quotaPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${quotaPercent}%` }} />
      </div>
      {elapsedPercent !== undefined ? (
        <>
          <div
            className="progress progress--time"
            role="progressbar"
            aria-label={`${label} time elapsed`}
            aria-valuenow={elapsedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${elapsedPercent}%` }} />
          </div>
          <div className="quota-row__meta">
            <span>{timeLabel}</span>
            <span className={`pace pace--${paceKind ?? "on-pace"}`}>
              {paceLabel}
            </span>
          </div>
        </>
      ) : (
        <p className="quota-row__meta quota-row__meta--untimed">
          <span>No reset timing</span>
          <span className="pace">{paceLabel}</span>
        </p>
      )}
    </section>
  );
}
