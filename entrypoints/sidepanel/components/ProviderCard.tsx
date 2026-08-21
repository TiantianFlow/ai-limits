import React from "react";

import { l10n } from "../../../i18n/index";
import { localizeOperation } from "../../../i18n/presentation";
import type {
  DisplayMode,
  PaceKind,
  ProviderInstanceView,
  ProviderInstanceId,
  ProviderKind,
  ProviderOperation,
  QuotaMetric,
  UsageHistoryObservation,
} from "../../../domain/public-protocol";
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
    ? localizeOperation(operation)
    : stale
      ? l10n.t("status.stale", {
          freshness: freshness ?? l10n.t("status.staleFallback"),
        })
      : attemptMessage
        ? freshness
          ? l10n.t("status.attention", { freshness })
          : l10n.t("status.needsAttention")
        : freshness ??
          (access === "required"
            ? l10n.t("status.notConnected")
            : l10n.t("status.noUsageYet"));
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
      aria-label={
        instanceLabel === name
          ? name
          : l10n.t("card.identityNamed", {
              provider: name,
              instance: instanceLabel,
            })
      }
    >
      <header className="provider-card__header">
        {onOpenDetails ? (
          <button
            className="provider-card__details provider-card__identity"
            type="button"
            aria-label={l10n.t("card.openDetails", { label: instanceLabel })}
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
              {group.description ? (
                <p className="provider-card__group-description">
                  {group.description}
                </p>
              ) : null}
              {group.quotas.map((quota) => (
                <QuotaBars
                  key={quota.id}
                  {...quota}
                  mode={mode}
                  historyLabel={l10n.t("quota.historyNamed", {
                    instance: instanceLabel,
                    label: quota.label,
                  })}
                  historyFocusKey={`provider-history-${instanceId}-${quota.id}`}
                  onOpenHistory={onOpenHistory}
                />
              ))}
            </section>
          ))}
        </div>
      ) : null}

      {values.length ? (
        <section
          className="metric-values"
          aria-label={l10n.t("card.values", { provider: name })}
        >
          <h3 className="visually-hidden">
            {l10n.t("card.countersAndBalances")}
          </h3>
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
