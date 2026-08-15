import React from "react";

import { Icon } from "./Icon";

export interface SummaryBarProps {
  message: string;
  onDismiss?: () => void;
}

export function SummaryBar({ message, onDismiss }: SummaryBarProps) {
  if (!message) {
    return null;
  }

  const needsAttention =
    /couldn.t|could not|\bneeds?\b|unchanged|not connected|not updated/i.test(
      message,
    );

  return (
    <div
      className={`summary-bar ${needsAttention ? "summary-bar--attention" : ""}`}
      role="status"
      aria-live="polite"
    >
      <Icon name={needsAttention ? "info" : "check"} />
      <p>{message}</p>
      {onDismiss ? (
        <button
          className="summary-bar__dismiss"
          type="button"
          aria-label="Dismiss refresh summary"
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

export function RefreshAnnouncement({ message }: SummaryBarProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="visually-hidden" role="status" aria-live="polite">
      {message}
    </div>
  );
}
