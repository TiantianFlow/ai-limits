import React from "react";

import type { ProviderOperation } from "../../../background/messages";
import type { DisplayMode, ProviderRecord } from "../../../domain/model";
import type { PaceKind } from "../../../domain/quota";
import { QuotaRow } from "./QuotaRow";

export interface QuotaView {
  id: string;
  label: string;
  quotaPercent: number;
  timePercent?: number;
  timeLabel?: string;
  resetAt?: number;
  resetLabel?: string;
  paceKind?: PaceKind;
  paceLabel: string;
}

export interface CreditView {
  id: string;
  label: string;
  value: string;
}

export interface ProviderCardProps {
  name: string;
  plan?: string;
  mode: DisplayMode;
  quotas: QuotaView[];
  credits: CreditView[];
  freshness?: string;
  stale: boolean;
  access: ProviderRecord["access"];
  operation?: ProviderOperation;
  attemptMessage?: string;
  hasSnapshot: boolean;
  emptyDescription: string;
  extraDisclosure?: string;
  action?: {
    label: string;
    accessibleLabel: string;
    onClick: () => void;
  };
}

const operationLabels: Record<ProviderOperation, string> = {
  requesting_permission: "Requesting permission…",
  fetching: "Fetching usage…",
  waiting_for_session: "Waiting for Kimi…",
};

export function ProviderCard({
  name,
  plan,
  mode,
  quotas,
  credits,
  freshness,
  stale,
  access,
  operation,
  attemptMessage,
  hasSnapshot,
  emptyDescription,
  extraDisclosure,
  action,
}: ProviderCardProps) {
  return (
    <article className="provider-card" aria-labelledby={`provider-${name}`}>
      <header className="provider-card__header">
        <div>
          <h2 id={`provider-${name}`}>{name}</h2>
          {plan ? <p>{plan}</p> : null}
        </div>
        {access === "required" || (hasSnapshot && action) ? (
          <div className="provider-card__header-actions">
            {access === "required" ? (
              <span className="badge">Not connected</span>
            ) : null}
            {hasSnapshot && action ? (
              <button
                className="button button--secondary provider-card__header-action"
                type="button"
                aria-label={action.accessibleLabel}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {operation ? (
        <p className="operation-copy">{operationLabels[operation]}</p>
      ) : null}

      {stale || freshness ? (
        <p className={`freshness ${stale ? "freshness--stale" : ""}`}>
          {stale ? "Stale · " : ""}
          {freshness}
        </p>
      ) : null}

      {!hasSnapshot ? (
        <section className="provider-card__empty">
          <p>{emptyDescription}</p>
          {extraDisclosure ? <p>{extraDisclosure}</p> : null}
          {attemptMessage ? <p className="health-message">{attemptMessage}</p> : null}
          {action ? (
            <button
              className="button button--secondary"
              type="button"
              aria-label={action.accessibleLabel}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ) : null}
        </section>
      ) : attemptMessage ? (
        <p className="health-message">{attemptMessage}</p>
      ) : null}

      {hasSnapshot && access === "required" ? (
        <div className="permission-disclosure">
          <p>{emptyDescription}</p>
          {extraDisclosure ? <p>{extraDisclosure}</p> : null}
        </div>
      ) : null}

      {quotas.length ? (
        <div className="provider-card__quotas">
          {quotas.map((quota) => (
            <QuotaRow key={quota.id} {...quota} mode={mode} />
          ))}
        </div>
      ) : null}

      {credits.length ? (
        <section className="credits" aria-label={`${name} credits`}>
          <h3>Credits</h3>
          {credits.map((credit) => (
            <div className="credit-row" key={credit.id}>
              <span>{credit.label}</span>
              <strong>{credit.value}</strong>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}
