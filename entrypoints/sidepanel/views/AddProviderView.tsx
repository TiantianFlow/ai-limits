import React from "react";

import type { ProviderKind, ProviderOperation } from "../../../domain/public-protocol";
import { PageHeader } from "../components/PageHeader";
import { ProviderConnectRow } from "../components/ProviderConnectRow";

export interface AddProviderViewProps {
  providers: Array<{
    providerKind: ProviderKind;
    credentialKind: "none" | "api-key";
    operation?: ProviderOperation;
  }>;
  origin: "overview" | "settings";
  onBack: () => void;
  onConnectProvider: (providerKind: ProviderKind) => void;
}

export function AddProviderView({
  providers,
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
            {providers.map(({ providerKind, credentialKind, operation }) => (
              <ProviderConnectRow
                key={providerKind}
                providerKind={providerKind}
                credentialKind={credentialKind}
                operation={operation}
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
