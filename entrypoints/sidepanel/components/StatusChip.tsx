import React from "react";

export interface StatusChipProps {
  label: string;
  tone?: "neutral" | "attention";
}

export function StatusChip({ label, tone = "neutral" }: StatusChipProps) {
  return (
    <span
      className={`status-chip ${tone === "attention" ? "status-chip--attention" : ""}`}
      title={label}
    >
      <span aria-hidden="true" className="status-chip__dot" />
      <span className="status-chip__label">{label}</span>
    </span>
  );
}
