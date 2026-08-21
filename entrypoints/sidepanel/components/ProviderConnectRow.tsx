import React from "react";

import { formatList } from "../../../i18n/format";
import { l10n } from "../../../i18n/index";
import {
  localizeCapability,
  localizeConnectLabel,
  localizeConnectionDisclosure,
  localizeManualRefreshDisclosure,
  localizeOperation,
  localizeProviderName,
  providerCapabilityIds,
} from "../../../i18n/presentation";
import {
  type ProviderKind,
  type ProviderOperation,
} from "../../../domain/public-protocol";
import { ProviderMark } from "./ProviderMark";

export interface ProviderConnectRowProps {
  providerKind: ProviderKind;
  credentialKind: "none" | "api-key";
  isReconnect?: boolean;
  operation?: ProviderOperation;
  onConnect: (providerKind: ProviderKind) => void;
}

export function ProviderConnectRow({
  providerKind,
  credentialKind,
  isReconnect = false,
  operation,
  onConnect,
}: ProviderConnectRowProps) {
  const name = localizeProviderName(providerKind);
  const connectionMethod =
    credentialKind === "api-key"
      ? l10n.t("common.apiKey")
      : l10n.t("common.browserSession");
  const headingId = `connect-${providerKind}`;
  const capabilities = formatList(
    providerCapabilityIds(providerKind).map((id) =>
      localizeCapability(providerKind, id),
    ),
  );
  const manualDisclosure = localizeManualRefreshDisclosure(providerKind);
  const actionLabel = isReconnect
    ? l10n.t("connections.reconnectProvider", { provider: name })
    : localizeConnectLabel(providerKind);

  return (
    <article className="provider-connect-row" aria-labelledby={headingId}>
      <div className="provider-connect-row__top">
        <div className="provider-connect-row__identity">
          <ProviderMark providerId={providerKind} size="md" />
          <div>
            <h3 id={headingId}>{name}</h3>
            <p>{l10n.t("connections.canShow", { capabilities })}</p>
          </div>
        </div>
        <button
          className="provider-connect-row__action"
          type="button"
          aria-label={actionLabel}
          data-focus-key={`connect-provider-${providerKind}`}
          aria-busy={operation !== undefined}
          disabled={operation !== undefined}
          onClick={() => onConnect(providerKind)}
          style={{ minHeight: 44 }}
        >
          <span
            aria-hidden="true"
            className="provider-connect-row__action-surface"
            style={{ height: 32 }}
          >
            {isReconnect ? l10n.t("common.reconnect") : l10n.t("common.connect")}
          </span>
        </button>
      </div>
      <p className="provider-connect-row__disclosure">
        <strong>{connectionMethod}</strong> —{" "}
        <span>{localizeConnectionDisclosure(providerKind)}</span>
      </p>
      {manualDisclosure ? (
        <p className="provider-connect-row__manual-disclosure">
          {manualDisclosure}
        </p>
      ) : null}
      {operation ? (
        <p className="operation-copy">{localizeOperation(operation)}</p>
      ) : null}
    </article>
  );
}
