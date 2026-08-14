import React from "react";

import {
  providerPresentation,
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

const operationLabels: Record<ProviderOperation, string> = {
  requesting_permission: "Requesting permission…",
  fetching: "Fetching usage…",
  waiting_for_session: "Waiting for Kimi…",
};

function statusFor(
  provider: ProviderCardProps,
  operation: ProviderOperation | undefined,
): { label: string; attention: boolean } {
  if (operation) {
    return {
      label: operationLabels[operation],
      attention: operation === "waiting_for_session",
    };
  }

  if (provider.stale) {
    return {
      label: `Stale · ${provider.freshness ?? "last known values"}`,
      attention: true,
    };
  }

  if (provider.attemptMessage) {
    return {
      label: provider.freshness
        ? `Attention · ${provider.freshness}`
        : "Needs attention",
      attention: true,
    };
  }

  return {
    label: provider.freshness ?? "No usage yet",
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
      <section className="screen" aria-label="Provider unavailable">
        <PageHeader
          title="Provider unavailable"
          subtitle="This provider is no longer connected"
          backLabel="Overview"
          onBack={onBack}
        />
        <div className="screen-body">
          <p className="illustrative-note">
            Its usage is unavailable until you connect it again from Add provider.
          </p>
          <button className="button button--secondary" type="button" onClick={onHome}>
            Return to Overview
          </button>
        </div>
      </section>
    );
  }

  const presentation = providerPresentation(provider.providerId);
  const status = statusFor(provider, operation);
  const showingLastKnown =
    provider.hasSnapshot &&
    (operation !== undefined || provider.stale || Boolean(provider.attemptMessage));
  const firstWindow = provider.usageGroups.flatMap((group) => group.quotas)[0];
  const interactionMessage =
    provider.attemptMessage ??
    (operation === "waiting_for_session"
      ? "Kimi needs a browser session. Existing values stay visible while the read waits."
      : undefined);

  return (
    <section className="screen" aria-label={`${provider.instanceLabel} detail`}>
      <PageHeader
        title={provider.instanceLabel}
        subtitle={[provider.name, provider.plan, "Provider usage"].filter(Boolean).join(" · ")}
        backLabel="Overview"
        onBack={onBack}
        actions={
          <>
            <button
              className="icon-button"
              type="button"
              aria-label={`Refresh ${provider.instanceLabel}`}
              title={`Refresh ${provider.instanceLabel}`}
              data-focus-key={`provider-refresh-${provider.instanceId}`}
              disabled={operation !== undefined}
              onClick={() => onRefreshInstance(provider.instanceId)}
            >
              <Icon name="refresh" className={operation ? "icon--spin" : ""} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={`Settings for ${provider.instanceLabel}`}
              title={`Settings for ${provider.instanceLabel}`}
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
          {showingLastKnown ? <span>Showing last known values</span> : null}
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
                    <span>Usage group</span>
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
                            historyLabel={`Open ${provider.instanceLabel} history for ${quota.label}`}
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
                      <p>Counters and balances are stored as point-in-time observations.</p>
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
            aria-label={`Open ${provider.instanceLabel} history`}
            data-focus-key={`provider-history-${provider.instanceId}`}
            onClick={() => onOpenHistory(provider.instanceId, firstWindow?.id)}
          >
            <Icon name="trending-up" />
            Open history
          </button>
        ) : null}

        <section className="connection-surface" aria-labelledby="connection-title">
          <h2 id="connection-title">Connection and capabilities</h2>
          <p>{presentation.connectionDisclosure}</p>
          <ul>
            {presentation.capabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
          {presentation.manualRefreshDisclosure ? (
            <p>{presentation.manualRefreshDisclosure}</p>
          ) : (
            <p>Scheduled refresh reads the existing session without opening a tab.</p>
          )}
          <button
            type="button"
            aria-label={`Manage ${provider.instanceLabel} in Settings`}
            onClick={onOpenSettings}
          >
            Manage or disconnect in Settings
          </button>
        </section>
      </article>
    </section>
  );
}
