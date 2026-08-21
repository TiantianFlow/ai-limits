import React from "react";

import { l10n } from "../../../i18n/index";
import type { ProviderKind, ProviderOperation } from "../../../domain/public-protocol";
import { PageHeader } from "../components/PageHeader";
import { ProviderConnectRow } from "../components/ProviderConnectRow";

export interface AddProviderViewProps {
  providers: Array<{
    providerKind: ProviderKind;
    credentialKind: "none" | "api-key";
    isReconnect?: boolean;
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
    <section className="screen" aria-label={l10n.t("addProvider.screen")}>
      <PageHeader
        title={l10n.t("addProvider.title")}
        subtitle={l10n.t("addProvider.subtitle")}
        backLabel={
          origin === "settings"
            ? l10n.t("common.settings")
            : l10n.t("common.overview")
        }
        onBack={onBack}
      />
      <div className="screen-body screen-body--connections">
        <h2 className="section-label">
          {l10n.t("addProvider.available", { count: providers.length })}
        </h2>
        {providers.length ? (
          <div className="provider-list">
            {providers.map(
              ({ providerKind, credentialKind, isReconnect, operation }) => (
                <ProviderConnectRow
                  key={providerKind}
                  providerKind={providerKind}
                  credentialKind={credentialKind}
                  isReconnect={isReconnect}
                  operation={operation}
                  onConnect={onConnectProvider}
                />
              ),
            )}
          </div>
        ) : (
          <p className="empty-surface">{l10n.t("addProvider.allConnected")}</p>
        )}
        <p className="illustrative-note">{l10n.t("addProvider.permissionNote")}</p>
      </div>
    </section>
  );
}
