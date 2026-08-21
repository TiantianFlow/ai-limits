import React from "react";

import { l10n } from "../../../i18n/index";
import {
  localizeCapability,
  localizeConnectionDisclosure,
  localizeManualRefreshDisclosure,
  localizeOperation,
  providerCapabilityIds,
} from "../../../i18n/presentation";
import {
  type ProviderInstanceId,
  type ProviderOperation,
} from "../../../domain/public-protocol";
import { Icon } from "../components/Icon";
import { InteractionBanner } from "../components/InteractionBanner";
import { PageHeader } from "../components/PageHeader";
import type { ProviderCardProps } from "../components/ProviderCard";
import { ProviderMark } from "../components/ProviderMark";
import { QuotaBars } from "../components/QuotaBars";
import { StatusChip } from "../components/StatusChip";

export interface ProviderDetailViewProps {
  provider?: ProviderCardProps;
  operation?: ProviderOperation;
  onBack: () => void;
  onHome: () => void;
  onRefreshInstance: (instanceId: ProviderInstanceId) => void;
  onOpenHistory: (
    instanceId: ProviderInstanceId,
    metricId?: string,
    focusKey?: string,
  ) => void;
  onOpenSettings: () => void;
}

function statusFor(
  provider: ProviderCardProps,
  operation: ProviderOperation | undefined,
): { label: string; attention: boolean } {
  if (operation) {
    return {
      label: localizeOperation(operation),
      attention: operation === "waiting_for_session",
    };
  }

  if (provider.stale) {
    return {
      label: l10n.t("status.stale", {
        freshness: provider.freshness ?? l10n.t("status.staleFallback"),
      }),
      attention: true,
    };
  }

  if (provider.attemptMessage) {
    return {
      label: provider.freshness
        ? l10n.t("status.attention", { freshness: provider.freshness })
        : l10n.t("status.needsAttention"),
      attention: true,
    };
  }

  return {
    label: provider.freshness ?? l10n.t("status.noUsageYet"),
    attention: false,
  };
}

export function ProviderDetailView({
  provider,
  operation,
  onBack,
  onHome,
  onRefreshInstance,
  onOpenHistory,
  onOpenSettings,
}: ProviderDetailViewProps) {
  if (!provider) {
    return (
      <section className="screen" aria-label={l10n.t("providerDetail.screenUnavailable")}>
        <PageHeader
          title={l10n.t("providerDetail.titleUnavailable")}
          subtitle={l10n.t("providerDetail.subtitleUnavailable")}
          backLabel={l10n.t("common.overview")}
          onBack={onBack}
        />
        <div className="screen-body">
          <p className="illustrative-note">
            {l10n.t("providerDetail.unavailableNote")}
          </p>
          <button className="button button--secondary" type="button" onClick={onHome}>
            {l10n.t("providerDetail.returnToOverview")}
          </button>
        </div>
      </section>
    );
  }

  const status = statusFor(provider, operation);
  const showingLastKnown =
    provider.hasSnapshot &&
    (operation !== undefined || provider.stale || Boolean(provider.attemptMessage));
  const firstWindow = provider.usageGroups.flatMap((group) => group.quotas)[0];
  const interactionMessage =
    provider.attemptMessage ??
    (operation === "waiting_for_session"
      ? l10n.t("refresh.kimiWaitingWithValues")
      : undefined);

  return (
    <section
      className="screen"
      aria-label={l10n.t("providerDetail.screenNamed", {
        label: provider.instanceLabel,
      })}
    >
      <PageHeader
        title={provider.instanceLabel}
        subtitle={
          provider.plan
            ? l10n.t("providerDetail.subtitleWithPlan", {
                provider: provider.name,
                plan: provider.plan,
              })
            : l10n.t("providerDetail.subtitle", { provider: provider.name })
        }
        backLabel={l10n.t("common.overview")}
        onBack={onBack}
        actions={
          <>
            <button
              className="icon-button"
              type="button"
              aria-label={l10n.t("providerDetail.refreshNamed", {
                label: provider.instanceLabel,
              })}
              title={l10n.t("providerDetail.refreshNamed", {
                label: provider.instanceLabel,
              })}
              data-focus-key={`provider-refresh-${provider.instanceId}`}
              disabled={operation !== undefined}
              onClick={() => onRefreshInstance(provider.instanceId)}
            >
              <Icon name="refresh" className={operation ? "icon--spin" : ""} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={l10n.t("providerDetail.settingsNamed", {
                label: provider.instanceLabel,
              })}
              title={l10n.t("providerDetail.settingsNamed", {
                label: provider.instanceLabel,
              })}
              data-focus-key={`provider-settings-${provider.instanceId}`}
              onClick={onOpenSettings}
            >
              <Icon name="settings" />
            </button>
          </>
        }
      />

      <article className="provider-detail screen-body" aria-label={provider.instanceLabel}>
        <div className="provider-detail__status">
          <ProviderMark providerId={provider.providerId} size="md" />
          <StatusChip
            label={status.label}
            tone={status.attention ? "attention" : "neutral"}
          />
          {showingLastKnown ? (
            <span>{l10n.t("providerDetail.showingLastKnown")}</span>
          ) : null}
        </div>

        {interactionMessage ? (
          <InteractionBanner>{interactionMessage}</InteractionBanner>
        ) : null}

        {provider.hasSnapshot
          ? provider.usageGroups.map((group) => {
              const headingId = `provider-detail-${provider.instanceId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${group.id}`;
              return (
                <section
                  className="detail-group"
                  aria-labelledby={headingId}
                  key={group.id}
                >
                  <div className="detail-group__heading">
                    <h2 id={headingId}>{group.label}</h2>
                    <span>{l10n.t("providerDetail.usageGroup")}</span>
                  </div>
                  {group.description ? <p>{group.description}</p> : null}
                  {group.quotas.length ? (
                    <div className="detail-group__quotas">
                      {group.quotas.map((quota) => {
                        const historyFocusKey =
                          `provider-history-${provider.instanceId}-${quota.id}`;

                        return (
                          <QuotaBars
                            key={quota.id}
                            {...quota}
                            mode={provider.mode}
                            historyLabel={l10n.t("quota.historyNamed", {
                              instance: provider.instanceLabel,
                              label: quota.label,
                            })}
                            historyFocusKey={historyFocusKey}
                            onOpenHistory={(metricId) =>
                              onOpenHistory(
                                provider.instanceId,
                                metricId,
                                historyFocusKey,
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}
                  {group.values.length ? (
                    <div className="detail-group__credits">
                      {group.values.map((metric) => (
                        <div className="credit-row" key={metric.id}>
                          <span>{metric.label}</span>
                          <strong>{metric.value}</strong>
                        </div>
                      ))}
                      <p>{l10n.t("providerDetail.countersNote")}</p>
                    </div>
                  ) : null}
                </section>
              );
            })
          : (
            <p className="illustrative-note">{provider.emptyDescription}</p>
          )}

        {firstWindow ? (
          <button
            className="detail-history-action"
            type="button"
            aria-label={l10n.t("providerDetail.openHistoryNamed", {
              label: provider.instanceLabel,
            })}
            data-focus-key={`provider-history-${provider.instanceId}`}
            onClick={() => onOpenHistory(provider.instanceId, firstWindow?.id)}
          >
            <Icon name="trending-up" />
            {l10n.t("providerDetail.openHistory")}
          </button>
        ) : null}

        <section className="connection-surface" aria-labelledby="connection-title">
          <h2 id="connection-title">{l10n.t("providerDetail.connectionTitle")}</h2>
          <p>{localizeConnectionDisclosure(provider.providerId)}</p>
          <ul>
            {providerCapabilityIds(provider.providerId).map((capabilityId) => (
              <li key={capabilityId}>
                {localizeCapability(provider.providerId, capabilityId)}
              </li>
            ))}
          </ul>
          {localizeManualRefreshDisclosure(provider.providerId) ? (
            <p>{localizeManualRefreshDisclosure(provider.providerId)}</p>
          ) : (
            <p>{l10n.t("providerDetail.scheduledNoTab")}</p>
          )}
          <button
            type="button"
            aria-label={l10n.t("providerDetail.manageNamed", {
              label: provider.instanceLabel,
            })}
            onClick={onOpenSettings}
          >
            {l10n.t("providerDetail.manageInSettings")}
          </button>
        </section>
      </article>
    </section>
  );
}
