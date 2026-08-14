import React from "react";

import type { ProviderOperation } from "../../../domain/public-protocol";
import type { ProviderKind } from "../../../providers/catalog";
import {
  providerCatalog,
  providerNames,
  providerPresentation,
} from "../../../providers/catalog";
import { ProviderMark } from "./ProviderMark";

export interface ProviderConnectRowProps {
  providerKind: ProviderKind;
  operation?: ProviderOperation;
  onConnect: (providerKind: ProviderKind) => void;
}

const operationLabels: Record<ProviderOperation, string> = {
  requesting_permission: "Requesting permission…",
  fetching: "Fetching usage…",
  waiting_for_session: "Waiting for Kimi…",
};

export function ProviderConnectRow({
  providerKind,
  operation,
  onConnect,
}: ProviderConnectRowProps) {
  const name = providerNames[providerKind];
  const presentation = providerPresentation(providerKind);
  const connectionMethod =
    providerCatalog[providerKind].connection.kind === "api-key"
      ? "API key"
      : "Browser session";
  const headingId = `connect-${providerKind}`;

  return (
    <article className="provider-connect-row" aria-labelledby={headingId}>
      <div className="provider-connect-row__top">
        <div className="provider-connect-row__identity">
          <ProviderMark providerId={providerKind} size="md" />
          <div>
            <h3 id={headingId}>{name}</h3>
            <p>Can show: {presentation.capabilities.join(" · ")}</p>
          </div>
        </div>
        <button
          className="provider-connect-row__action"
          type="button"
          aria-label={presentation.connectionLabel}
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
