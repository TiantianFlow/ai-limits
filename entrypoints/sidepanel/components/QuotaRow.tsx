import React from "react";

import type { DisplayMode } from "../../../domain/model";
import type { PaceKind } from "../../../domain/quota";

export interface QuotaRowProps {
  label: string;
  mode: DisplayMode;
  quotaPercent: number;
  timePercent?: number;
  timeLabel?: string;
  resetAt?: number;
  resetLabel?: string;
  paceKind?: PaceKind;
  paceLabel: string;
}

export function QuotaRow({
  label,
  mode,
  quotaPercent,
  timePercent,
  timeLabel,
  resetAt,
  resetLabel,
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
      {timePercent !== undefined ? (
        <>
          <div
            className="progress progress--time"
            role="progressbar"
            aria-label={`${label} time ${mode === "used" ? "elapsed" : "remaining"}`}
            aria-valuenow={timePercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${timePercent}%` }} />
          </div>
          <div className="quota-row__meta">
            <span className="quota-row__timing">
              <span>{timeLabel}</span>
              {resetAt !== undefined && resetLabel ? (
                <time dateTime={new Date(resetAt).toISOString()}>{resetLabel}</time>
              ) : null}
            </span>
            <span className={`pace pace--${paceKind ?? "on-pace"}`}>
              {paceLabel}
            </span>
          </div>
        </>
      ) : (
        <p className="quota-row__meta quota-row__meta--untimed">
          {resetAt !== undefined && resetLabel ? (
            <time dateTime={new Date(resetAt).toISOString()}>{resetLabel}</time>
          ) : (
            <span>No reset timing</span>
          )}
          <span className="pace">{paceLabel}</span>
        </p>
      )}
    </section>
  );
}
