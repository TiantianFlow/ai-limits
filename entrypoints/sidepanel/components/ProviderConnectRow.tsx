import React from "react";

import type { ProviderOperation } from "../../../background/messages";
import type { ProviderId } from "../../../domain/model";
import {
  providerCatalog,
  providerNames,
  providerPresentation,
} from "../../../providers/catalog";
import { ProviderMark } from "./ProviderMark";

export interface ProviderConnectRowProps {
  providerId: ProviderId;
  operation?: ProviderOperation;
  onConnect: (providerId: ProviderId) => void;
}

const operationLabels: Record<ProviderOperation, string> = {
  requesting_permission: "Requesting permission…",
  fetching: "Fetching usage…",
  waiting_for_session: "Waiting for Kimi…",
};

export function ProviderConnectRow({
  providerId,
  operation,
  onConnect,
}: ProviderConnectRowProps) {
  const name = providerNames[providerId];
  const presentation = providerPresentation(providerId);
  const connectionMethod =
    providerCatalog[providerId].connection.kind === "api-key"
      ? "API key"
      : "Browser session";
  const headingId = `connect-${providerId}`;

  return (
    <article className="provider-connect-row" aria-labelledby={headingId}>
      <div className="provider-connect-row__top">
        <div className="provider-connect-row__identity">
          <ProviderMark providerId={providerId} size="md" />
          <div>
            <h3 id={headingId}>{name}</h3>
            <p>Can show: {presentation.capabilities.join(" · ")}</p>
          </div>
        </div>
        <button
          className="provider-connect-row__action"
          type="button"
          aria-label={presentation.connectionLabel}
          data-focus-key={`connect-provider-${providerId}`}
          aria-busy={operation !== undefined}
          disabled={operation !== undefined}
          onClick={() => onConnect(providerId)}
          style={{ minHeight: 44 }}
        >
          <span
            aria-hidden="true"
            className="provider-connect-row__action-surface"
            style={{ height: 32 }}
          >
            Connect
          </span>
        </button>
      </div>
      <p className="provider-connect-row__disclosure">
        <strong>{connectionMethod}</strong> —{" "}
        <span>{presentation.connectionDisclosure}</span>
      </p>
      {presentation.manualRefreshDisclosure ? (
        <p className="provider-connect-row__manual-disclosure">
          {presentation.manualRefreshDisclosure}
        </p>
      ) : null}
      {operation ? <p className="operation-copy">{operationLabels[operation]}</p> : null}
    </article>
  );
}
