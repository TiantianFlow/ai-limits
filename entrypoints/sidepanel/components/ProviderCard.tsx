import React from "react";

import type { DisplayMode, ProviderHealth } from "../../../domain/model";
import type { PaceKind } from "../../../domain/quota";
import { QuotaRow } from "./QuotaRow";

export interface QuotaView {
  id: string;
  label: string;
  quotaPercent: number;
  elapsedPercent?: number;
  timeLabel?: string;
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
  source?: string;
  mode: DisplayMode;
  quotas: QuotaView[];
  credits: CreditView[];
  freshness?: string;
  stale: boolean;
  health: ProviderHealth;
  hasSnapshot: boolean;
  emptyDescription: string;
  action?: {
    label: string;
    accessibleLabel: string;
    onClick: () => void;
  };
}

const healthLabels: Record<ProviderHealth["kind"], string> = {
  permission_required: "Permission required",
  connecting: "Connecting",
  connected: "Connected",
  signed_out: "Signed out",
  challenge_blocked: "Check blocked",
  provider_changed: "Provider changed",
  temporary_error: "Temporarily unavailable",
  experimental_unavailable: "Experimental",
};

function healthMessage(health: ProviderHealth): string | undefined {
  return "message" in health ? health.message : undefined;
}

export function ProviderCard({
  name,
  plan,
  source,
  mode,
  quotas,
  credits,
  freshness,
  stale,
  health,
  hasSnapshot,
  emptyDescription,
  action,
}: ProviderCardProps) {
  const healthIsWarm = !["connected", "connecting"].includes(health.kind);

  return (
    <article className="provider-card" aria-labelledby={`provider-${name}`}>
      <header className="provider-card__header">
        <div>
          <h2 id={`provider-${name}`}>{name}</h2>
          {plan ? <p>{plan}</p> : null}
        </div>
        <div className="badge-row">
          {source ? <span className="badge">{source}</span> : null}
          <span className={`badge ${healthIsWarm ? "badge--warm" : ""}`}>
            {healthLabels[health.kind]}
          </span>
        </div>
      </header>

      {stale || freshness ? (
        <p className={`freshness ${stale ? "freshness--stale" : ""}`}>
          {stale ? "Stale · " : ""}
          {freshness}
        </p>
      ) : null}

      {!hasSnapshot ? (
        <section className="provider-card__empty">
          <p>{emptyDescription}</p>
          {healthMessage(health) && healthMessage(health) !== emptyDescription ? (
            <p className="health-message" role={healthIsWarm ? "status" : undefined}>
              {healthMessage(health)}
            </p>
          ) : null}
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
      ) : healthMessage(health) ? (
        <p className="health-message" role={healthIsWarm ? "status" : undefined}>
          {healthMessage(health)}
        </p>
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
