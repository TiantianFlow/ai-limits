import type { Ref } from "react";
import React from "react";

import type { ProviderOperation } from "../../../background/messages";
import type { ProviderId } from "../../../domain/model";
import type { ApiKeyProviderId } from "../../../providers/catalog";
import { providerNames } from "../../../providers/catalog";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import {
  ProviderCard,
  type ProviderCardProps,
} from "../components/ProviderCard";

export interface OverviewProvider {
  providerId: ProviderId;
  card: Omit<ProviderCardProps, "providerId" | "operation" | "action">;
  needsApiKeyReplacement?: boolean;
}

export interface OverviewViewProps {
  providers: OverviewProvider[];
  providerOperations: Partial<Record<ProviderId, ProviderOperation>>;
  addProviderButtonRef: Ref<HTMLButtonElement>;
  onAddProvider: (invoker: HTMLButtonElement) => void;
  onRefreshProvider: (providerId: ProviderId) => void;
  onOpenProvider: (providerId: ProviderId) => void;
  onOpenHistory: (providerId: ProviderId, metricId: string) => void;
  onReplaceApiKey: (providerId: ApiKeyProviderId) => void;
}

export function OverviewView({
  providers,
  providerOperations,
  addProviderButtonRef,
  onAddProvider,
  onRefreshProvider,
  onOpenProvider,
  onOpenHistory,
  onReplaceApiKey,
}: OverviewViewProps) {
  return (
    <section aria-labelledby="overview-title">
      <h2 className="visually-hidden" id="overview-title">
        Overview
      </h2>
      <div className="provider-list">
        {providers.map(({ providerId, card, needsApiKeyReplacement }) => {
          const operation = providerOperations[providerId];
          return (
            <ProviderCard
              key={providerId}
              {...card}
              providerId={providerId}
              operation={operation}
              openDetailsFocusKey={`overview-provider-${providerId}`}
              onOpenDetails={() => onOpenProvider(providerId)}
              onOpenHistory={
                card.hasSnapshot
                  ? (metricId) => onOpenHistory(providerId, metricId)
                  : undefined
              }
              action={
                operation
                  ? undefined
                  : needsApiKeyReplacement && providerId === "elevenlabs"
                    ? {
                        label: "Replace key",
                        accessibleLabel: "Replace ElevenLabs API key",
                        focusKey: "overview-replace-api-key-elevenlabs",
                        onClick: () => onReplaceApiKey("elevenlabs"),
                      }
                  : {
                      label: "Refresh",
                      accessibleLabel: `Refresh ${providerNames[providerId]}`,
                      onClick: () => onRefreshProvider(providerId),
                    }
              }
            />
          );
        })}
      </div>
      <button
        ref={addProviderButtonRef}
        className="add-provider-action"
        type="button"
        onClick={(event) => onAddProvider(event.currentTarget)}
      >
        <span aria-hidden="true">+</span>
        Add provider
      </button>
      <OpenSourceFooter />
    </section>
  );
}
