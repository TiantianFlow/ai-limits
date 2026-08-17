import React from "react";

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
        <h1><span aria-hidden="true" />AI Limits</h1>
        <h2 id="first-run-title">Connect your providers</h2>
        <p>
          Connect the providers you pay for and see every reported quota window
          in one place.
        </p>
        <ul>
          <li>One panel for every AI subscription quota you track.</li>
          <li>Access is opt-in per provider. Nothing is read until you connect it.</li>
          <li>Readings and history stay in this browser. No account, no sync.</li>
        </ul>
      </header>
      <div className="screen-body screen-body--connections">
        <h2 className="section-label">Supported providers · {providers.length}</h2>
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
        <p className="illustrative-note">
          Connect one provider at a time. There is no auto-discovery or demo
          usage; numbers appear only after a successful provider read.
        </p>
        <OpenSourceFooter showIssues={false} />
      </div>
    </section>
  );
}
