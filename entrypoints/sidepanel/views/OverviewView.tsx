import type { Ref } from "react";
import React from "react";

import type { ProviderOperation } from "../../../domain/public-protocol";
import type { ProviderInstanceId } from "../../../domain/instances";
import type { ApiKeyProviderKind, ProviderKind } from "../../../providers/catalog";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import {
  ProviderCard,
  type ProviderCardProps,
} from "../components/ProviderCard";

export interface OverviewProvider {
  instanceId: ProviderInstanceId;
  providerKind: ProviderKind;
  card: Omit<ProviderCardProps, "operation" | "action">;
  needsApiKeyReplacement?: boolean;
}

export interface OverviewViewProps {
  providers: OverviewProvider[];
  providerOperations: Partial<Record<ProviderInstanceId, ProviderOperation>>;
  addProviderButtonRef: Ref<HTMLButtonElement>;
  onAddProvider: (invoker: HTMLButtonElement) => void;
  onRefreshInstance: (instanceId: ProviderInstanceId) => void;
  onOpenProvider: (instanceId: ProviderInstanceId) => void;
  onOpenHistory: (instanceId: ProviderInstanceId, metricId: string) => void;
  onReplaceApiKey: (
    providerKind: ApiKeyProviderKind,
    instanceId: ProviderInstanceId,
  ) => void;
}

export function OverviewView({
  providers,
  providerOperations,
  addProviderButtonRef,
  onAddProvider,
  onRefreshInstance,
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
        {providers.map(({ instanceId, providerKind, card, needsApiKeyReplacement }) => {
          const operation = providerOperations[instanceId];
          return (
            <ProviderCard
              key={instanceId}
              {...card}
              operation={operation}
              openDetailsFocusKey={`overview-provider-${instanceId}`}
              onOpenDetails={() => onOpenProvider(instanceId)}
              onOpenHistory={
                card.hasSnapshot
                  ? (metricId) => onOpenHistory(instanceId, metricId)
                  : undefined
              }
              action={
                operation
                  ? undefined
                  : needsApiKeyReplacement
                    ? {
                        label: "Replace key",
                        accessibleLabel: `Replace ${card.instanceLabel} API key`,
                        title: `Replace ${card.instanceLabel} API key`,
                        icon: "key",
                        focusKey: `overview-replace-api-key-${instanceId}`,
                        onClick: () =>
                          onReplaceApiKey(
                            providerKind as ApiKeyProviderKind,
                            instanceId,
                          ),
                      }
                  : {
                      label: "Refresh",
                      accessibleLabel: `Refresh ${card.instanceLabel}`,
                      focusKey: `overview-refresh-${instanceId}`,
                      onClick: () => onRefreshInstance(instanceId),
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
