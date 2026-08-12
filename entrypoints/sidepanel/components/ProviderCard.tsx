import React from "react";

import type { ProviderOperation } from "../../../background/messages";
import type {
  DisplayMode,
  ProviderId,
  ProviderRecord,
  QuotaHistoryObservation,
  QuotaWindow,
} from "../../../domain/model";
import type { PaceKind } from "../../../domain/quota";
import { Icon } from "./Icon";
import { InteractionBanner } from "./InteractionBanner";
import { ProviderMark } from "./ProviderMark";
import { QuotaBars, type QuotaSegmentView } from "./QuotaBars";
import { StatusChip } from "./StatusChip";

export interface QuotaView {
  id: string;
  label: string;
  quotaPercent: number;
  usedPercent: number;
  valueLabel?: string;
  timePercent?: number;
  timeLabel?: string;
  resetAt?: number;
  resetLabel?: string;
  paceKind?: PaceKind;
  paceLabel: string;
  segments?: QuotaSegmentView[];
}

export interface CreditView {
  id: string;
  label: string;
  value: string;
}

export interface UsageGroupView {
  id: string;
  label: string;
  description?: string;
  quotas: QuotaView[];
  credits: CreditView[];
}

export interface ProviderCardProps {
  providerId: ProviderId;
  name: string;
  plan?: string;
  mode: DisplayMode;
  credits: CreditView[];
  usageGroups: UsageGroupView[];
  freshness?: string;
  stale: boolean;
  access: ProviderRecord["access"];
  operation?: ProviderOperation;
  attemptMessage?: string;
  hasSnapshot: boolean;
  history?: {
    windows: QuotaWindow[];
    observations: QuotaHistoryObservation[];
    now: number;
  };
  emptyDescription: string;
  extraDisclosure?: string;
  action?: {
    label: string;
    accessibleLabel: string;
    onClick: () => void;
  };
  headingLevel?: 2 | 3;
  openDetailsFocusKey?: string;
  onOpenDetails?: () => void;
  onOpenHistory?: (windowId: string) => void;
}

const operationLabels: Record<ProviderOperation, string> = {
  requesting_permission: "Requesting permission…",
  fetching: "Fetching usage…",
  waiting_for_session: "Waiting for Kimi…",
};

export function ProviderCard({
  providerId,
  name,
  plan,
  mode,
  credits,
  usageGroups,
  freshness,
  stale,
  access,
  operation,
  attemptMessage,
  hasSnapshot,
  history: _history,
  emptyDescription,
  extraDisclosure,
  action,
  headingLevel = 2,
  openDetailsFocusKey,
  onOpenDetails,
  onOpenHistory,
}: ProviderCardProps) {
  const quotaGroups = usageGroups.filter((group) => group.quotas.length > 0);
  const statusLabel = operation
    ? operationLabels[operation]
    : stale
      ? `Stale · ${freshness ?? "last known values"}`
      : attemptMessage
        ? freshness
          ? `Attention · ${freshness}`
          : "Needs attention"
        : freshness ?? (access === "required" ? "Not connected" : "No usage yet");
  const statusAttention =
    operation === "waiting_for_session" || stale || Boolean(attemptMessage);

  const identity = (
    <>
      <ProviderMark providerId={providerId} size="sm" />
      <span
        className="provider-card__name"
        id={`provider-${name}`}
        role="heading"
        aria-level={headingLevel}
      >
        {name}
      </span>
      {plan ? <span className="provider-card__plan">{plan}</span> : null}
      <span className="provider-card__status">
        <StatusChip
          label={statusLabel}
          tone={statusAttention ? "attention" : "neutral"}
        />
      </span>
    </>
  );

  return (
    <article className="provider-card" aria-labelledby={`provider-${name}`}>
      <header className="provider-card__header">
        {onOpenDetails ? (
          <button
            className="provider-card__details provider-card__identity"
            type="button"
            aria-label={`Open ${name} details`}
            data-focus-key={openDetailsFocusKey}
            onClick={onOpenDetails}
          >
            {identity}
            <Icon name="chevron-right" />
          </button>
        ) : (
          <div className="provider-card__details provider-card__details--static provider-card__identity">
            {identity}
          </div>
        )}
        {action ? (
          <button
            className="provider-card__refresh"
            type="button"
            aria-label={action.accessibleLabel}
            disabled={operation !== undefined}
            onClick={action.onClick}
          >
            <Icon
              name="refresh"
              className={operation ? "icon--spin" : ""}
            />
          </button>
        ) : null}
      </header>

      {!hasSnapshot ? (
        <section className="provider-card__empty">
          <p>{emptyDescription}</p>
          {extraDisclosure ? <p>{extraDisclosure}</p> : null}
          {attemptMessage ? <InteractionBanner>{attemptMessage}</InteractionBanner> : null}
        </section>
      ) : attemptMessage ? (
        <InteractionBanner>{attemptMessage}</InteractionBanner>
      ) : null}

      {hasSnapshot && access === "required" ? (
        <div className="permission-disclosure">
          <p>{emptyDescription}</p>
          {extraDisclosure ? <p>{extraDisclosure}</p> : null}
        </div>
      ) : null}

      {quotaGroups.length ? (
        <div className="provider-card__quotas">
          {quotaGroups.map((group) => (
            <section
              className="provider-card__quota-group"
              aria-label={group.label}
              key={group.id}
            >
              {group.quotas.map((quota) => (
                <QuotaBars
                  key={quota.id}
                  {...quota}
                  mode={mode}
                  historyLabel={`Open ${name} history for ${quota.label}`}
                  historyFocusKey={`provider-history-${providerId}-${quota.id}`}
                  onOpenHistory={onOpenHistory}
                />
              ))}
            </section>
          ))}
        </div>
      ) : null}

      {credits.length ? (
        <section className="credits" aria-label={`${name} credits`}>
          <h3 className="visually-hidden">Credits</h3>
          {credits.map((credit) => (
            <div className="credit-row" key={credit.id}>
              <span>{credit.label}</span>
              <strong>{credit.value}</strong>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}
