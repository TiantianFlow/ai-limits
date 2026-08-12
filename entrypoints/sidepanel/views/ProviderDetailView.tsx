import React from "react";

import type { ProviderOperation } from "../../../background/messages";
import type { ProviderId } from "../../../domain/model";
import {
  providerPresentation,
} from "../../../providers/catalog";
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
  onRefreshProvider: (providerId: ProviderId) => void;
  onOpenHistory: (
    providerId: ProviderId,
    windowId?: string,
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
  onRefreshProvider,
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
    <section className="screen" aria-label={`${provider.name} detail`}>
      <PageHeader
        title={provider.name}
        subtitle={[provider.plan, "Provider usage"].filter(Boolean).join(" · ")}
        backLabel="Overview"
        onBack={onBack}
        actions={
          <>
            <button
              className="icon-button"
              type="button"
              aria-label={`Refresh ${provider.name}`}
              title={`Refresh ${provider.name}`}
              disabled={operation !== undefined}
              onClick={() => onRefreshProvider(provider.providerId)}
            >
              <Icon name="refresh" className={operation ? "icon--spin" : ""} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Settings"
              title="Settings"
              data-focus-key={`provider-settings-${provider.providerId}`}
              onClick={onOpenSettings}
            >
              <Icon name="settings" />
            </button>
          </>
        }
      />

      <article className="provider-detail screen-body" aria-label={provider.name}>
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
              const headingId = `provider-detail-${provider.providerId}-${group.id}`;
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
                          `provider-history-${provider.providerId}-${quota.id}`;

                        return (
                          <QuotaBars
                            key={quota.id}
                            {...quota}
                            mode={provider.mode}
                            historyLabel={`Open ${provider.name} history for ${quota.label}`}
                            historyFocusKey={historyFocusKey}
                            onOpenHistory={(windowId) =>
                              onOpenHistory(
                                provider.providerId,
                                windowId,
                                historyFocusKey,
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}
                  {group.credits.length ? (
                    <div className="detail-group__credits">
                      {group.credits.map((credit) => (
                        <div className="credit-row" key={credit.id}>
                          <span>{credit.label}</span>
                          <strong>{credit.value}</strong>
                        </div>
                      ))}
                      <p>Point-in-time balance; credit values are not historized.</p>
                    </div>
                  ) : null}
                </section>
              );
            })
          : (
            <p className="illustrative-note">{provider.emptyDescription}</p>
          )}

        {provider.hasSnapshot ? (
          <button
            className="detail-history-action"
            type="button"
            aria-label={`Open ${provider.name} history`}
            data-focus-key={`provider-history-${provider.providerId}`}
            onClick={() => onOpenHistory(provider.providerId, firstWindow?.id)}
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
            aria-label={`Manage ${provider.name} in Settings`}
            onClick={onOpenSettings}
          >
            Manage or disconnect in Settings
          </button>
        </section>
      </article>
    </section>
  );
}
