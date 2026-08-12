import React from "react";

import type { ProviderOperation } from "../../../background/messages";
import type { ProviderId, ProviderRecord } from "../../../domain/model";
import { PageHeader } from "../components/PageHeader";
import { ProviderConnectRow } from "../components/ProviderConnectRow";

export interface AddProviderViewProps {
  providers: ProviderRecord[];
  providerOperations: Partial<Record<ProviderId, ProviderOperation>>;
  origin: "overview" | "settings";
  onBack: () => void;
  onConnectProvider: (providerId: ProviderId) => void;
}

export function AddProviderView({
  providers,
  providerOperations,
  origin,
  onBack,
  onConnectProvider,
}: AddProviderViewProps) {
  return (
    <section className="screen" aria-label="Add provider">
      <PageHeader
        title="Add provider"
        subtitle="Access is granted one provider at a time"
        backLabel={origin === "settings" ? "Settings" : "Overview"}
        onBack={onBack}
      />
      <div className="screen-body screen-body--connections">
        <h2 className="section-label">Available · {providers.length}</h2>
        {providers.length ? (
          <div className="provider-list">
            {providers.map((provider) => (
              <ProviderConnectRow
                key={provider.providerId}
                providerId={provider.providerId}
                operation={providerOperations[provider.providerId]}
                onConnect={onConnectProvider}
              />
            ))}
          </div>
        ) : (
          <p className="empty-surface">All supported providers are connected.</p>
        )}
        <p className="illustrative-note">
          Connect asks for permission for that provider only, then attempts an
          authenticated read. Nothing is pre-detected, and credentials are not
          stored with normalized usage.
        </p>
      </div>
    </section>
  );
}
