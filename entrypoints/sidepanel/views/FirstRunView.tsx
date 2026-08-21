import React from "react";

import { l10n } from "../../../i18n/index";
import type { ProviderKind, ProviderOperation } from "../../../domain/public-protocol";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import { ProviderConnectRow } from "../components/ProviderConnectRow";

export interface FirstRunViewProps {
  providers: Array<{
    providerKind: ProviderKind;
    credentialKind: "none" | "api-key";
    isReconnect?: boolean;
    operation?: ProviderOperation;
  }>;
  onConnectProvider: (providerKind: ProviderKind) => void;
}

export function FirstRunView({
  providers,
  onConnectProvider,
}: FirstRunViewProps) {
  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <header className="first-run__header">
        <h1><span aria-hidden="true" />{l10n.t("firstRun.brand")}</h1>
        <h2 id="first-run-title">{l10n.t("firstRun.title")}</h2>
        <p>{l10n.t("firstRun.introduction")}</p>
        <ul>
          <li>{l10n.t("firstRun.bulletPanel")}</li>
          <li>{l10n.t("firstRun.bulletOptIn")}</li>
          <li>{l10n.t("firstRun.bulletLocal")}</li>
        </ul>
      </header>
      <div className="screen-body screen-body--connections">
        <h2 className="section-label">
          {l10n.t("firstRun.supportedProviders", { count: providers.length })}
        </h2>
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
        <p className="illustrative-note">{l10n.t("firstRun.noDemo")}</p>
        <OpenSourceFooter showIssues={false} />
      </div>
    </section>
  );
}
