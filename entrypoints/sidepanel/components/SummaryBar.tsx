import React from "react";

import type { AnnouncementTone } from "../../../i18n/index";
import { l10n } from "../../../i18n/index";
import { Icon } from "./Icon";

export interface SummaryBarProps {
  message: string;
  tone?: AnnouncementTone;
  onDismiss?: () => void;
}

export function SummaryBar({
  message,
  tone = "success",
  onDismiss,
}: SummaryBarProps) {
  if (!message) {
    return null;
  }

  const needsAttention = tone === "attention";

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
          aria-label={l10n.t("announcements.dismiss")}
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
