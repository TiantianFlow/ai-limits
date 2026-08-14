import React from "react";

import type {
  ProviderInstanceView,
  ProviderOperation,
} from "../../../domain/public-protocol";
import type {
  DisplayMode,
  QuotaMetric,
  UsageHistoryObservation,
} from "../../../domain/model";
import type { ProviderInstanceId } from "../../../domain/instances";
import type { ProviderKind } from "../../../providers/catalog";
import type { PaceKind } from "../../../domain/quota";
import { Icon, type IconName } from "./Icon";
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

export interface MetricValueView {
  id: string;
  label: string;
  value: string;
}

export interface UsageGroupView {
  id: string;
  label: string;
  description?: string;
  quotas: QuotaView[];
  values: MetricValueView[];
}

export interface ProviderCardProps {
  instanceId: ProviderInstanceId;
  instanceLabel: string;
  providerId: ProviderKind;
  name: string;
  plan?: string;
  mode: DisplayMode;
  values: MetricValueView[];
  usageGroups: UsageGroupView[];
  freshness?: string;
  stale: boolean;
  access: ProviderInstanceView["access"];
  operation?: ProviderOperation;
  attemptMessage?: string;
  hasSnapshot: boolean;
  history?: {
    metrics: QuotaMetric[];
    observations: UsageHistoryObservation[];
    now: number;
  };
  emptyDescription: string;
  extraDisclosure?: string;
  action?: {
    label: string;
    accessibleLabel: string;
    icon?: IconName;
    title?: string;
    focusKey?: string;
    onClick: () => void;
  };
  headingLevel?: 2 | 3;
  openDetailsFocusKey?: string;
  onOpenDetails?: () => void;
  onOpenHistory?: (metricId: string) => void;
}

const operationLabels: Record<ProviderOperation, string> = {
  requesting_permission: "Requesting permission…",
  fetching: "Fetching usage…",
  waiting_for_session: "Waiting for Kimi…",
};

export function ProviderCard({
  providerId,
  instanceId,
  instanceLabel,
  name,
  plan,
  mode,
  values,
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
  const identitySuffix = instanceId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const headingId = `provider-name-${identitySuffix}`;
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
        id={headingId}
        role="heading"
        aria-level={headingLevel}
      >
        {name}
      </span>
      {instanceLabel !== name ? (
        <span className="provider-card__instance">
          {instanceLabel}
        </span>
      ) : null}
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
    <article
      className="provider-card"
      aria-label={instanceLabel === name ? name : `${name} ${instanceLabel}`}
    >
      <header className="provider-card__header">
        {onOpenDetails ? (
          <button
            className="provider-card__details provider-card__identity"
            type="button"
            aria-label={`Open ${instanceLabel} details`}
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
            title={action.title ?? action.accessibleLabel}
            data-focus-key={action.focusKey}
            disabled={operation !== undefined}
            onClick={action.onClick}
          >
            <Icon
              name={action.icon ?? "refresh"}
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
                  historyLabel={`Open ${instanceLabel} history for ${quota.label}`}
                  historyFocusKey={`provider-history-${instanceId}-${quota.id}`}
                  onOpenHistory={onOpenHistory}
                />
              ))}
            </section>
          ))}
        </div>
      ) : null}

      {values.length ? (
        <section className="metric-values" aria-label={`${name} values`}>
          <h3 className="visually-hidden">Counters and balances</h3>
          {values.map((metric) => (
            <div className="credit-row" key={metric.id}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}
