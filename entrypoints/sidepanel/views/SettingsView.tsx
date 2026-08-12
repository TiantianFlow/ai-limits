import type { Ref } from "react";
import React, { useEffect, useRef } from "react";

import type { ProviderId, ProviderRecord } from "../../../domain/model";
import {
  providerNames,
  providerPresentation,
} from "../../../providers/catalog";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

export interface SettingsViewProps {
  autoRefresh: boolean;
  autoRefreshPending: boolean;
  providers: ProviderRecord[];
  now: number;
  confirmDelete: boolean;
  addProviderButtonRef: Ref<HTMLButtonElement>;
  closeLabel?: string;
  onClose: () => void;
  onAddProvider: () => void;
  onAutoRefreshChange: (enabled: boolean) => void;
  onDisconnectProvider: (providerId: ProviderId) => void;
  onDeleteLocalData: () => void;
  onConfirmDeleteChange: (confirm: boolean) => void;
}

function freshness(provider: ProviderRecord, now: number): string {
  const fetchedAt = provider.snapshot?.fetchedAt;
  if (fetchedAt === undefined) {
    return "No successful read yet";
  }

  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
  if (minutes < 1) {
    return "Updated just now";
  }

  return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

export function SettingsView({
  autoRefresh,
  autoRefreshPending,
  providers,
  now,
  confirmDelete,
  addProviderButtonRef,
  closeLabel = "Overview",
  onClose,
  onAddProvider,
  onAutoRefreshChange,
  onDisconnectProvider,
  onDeleteLocalData,
  onConfirmDeleteChange,
}: SettingsViewProps) {
  const connectedProviders = providers.filter(
    (provider) => provider.access === "granted",
  );
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocus = useRef(false);

  useEffect(() => {
    if (!confirmDelete && restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmDelete]);

  return (
    <section className="screen settings-panel" aria-label="Provider settings">
      <PageHeader
        title="Settings"
        subtitle="Everything here is local to this browser"
        backLabel={closeLabel}
        onBack={onClose}
      />

      <div className="settings-screen screen-body">
        <section className="settings-surface" aria-labelledby="automatic-refresh-title">
          <label className="settings-toggle">
            <span className="settings-toggle__copy">
              <strong id="automatic-refresh-title">Automatic refresh</strong>
              <small>
                Checks connected providers about every 15 minutes. Scheduled
                refresh stays non-interactive and never takes over the browser.
              </small>
            </span>
            <span className="settings-toggle__control">
              <input
                type="checkbox"
                role="switch"
                aria-label="Automatic refresh"
                checked={autoRefresh}
                disabled={autoRefreshPending}
                aria-busy={autoRefreshPending}
                onChange={(event) =>
                  onAutoRefreshChange(event.currentTarget.checked)
                }
              />
              <span className="settings-toggle__track" aria-hidden="true">
                <span />
              </span>
            </span>
          </label>
          <p className="settings-state">
            {autoRefresh
              ? "On · about every 15 minutes"
              : "Off · refresh manually from the header"}
          </p>
        </section>

        <section className="settings-surface" aria-labelledby="connected-providers-title">
          <div className="settings-surface__heading">
            <h2 id="connected-providers-title">Connected providers</h2>
            <button
              ref={addProviderButtonRef}
              className="settings-add-action"
              type="button"
              onClick={onAddProvider}
            >
              <span aria-hidden="true">+</span>
              Add provider
            </button>
          </div>
          {connectedProviders.length ? (
            <ul className="settings-provider-list">
              {connectedProviders.map((provider) => {
                const name = providerNames[provider.providerId];
                const presentation = providerPresentation(provider.providerId);
                return (
                  <li key={provider.providerId} aria-label={`${name} settings`}>
                    <ProviderMark providerId={provider.providerId} size="sm" />
                    <div className="settings-provider-copy">
                      <p>
                        <strong>{name}</strong>{" "}
                        {provider.snapshot?.planLabel ? (
                          <span>{provider.snapshot.planLabel}</span>
                        ) : null}
                      </p>
                      <small>{freshness(provider, now)} · Browser session · read-only</small>
                      <small>{presentation.connectionDisclosure}</small>
                      {presentation.manualRefreshDisclosure ? (
                        <small>{presentation.manualRefreshDisclosure}</small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Disconnect ${name}`}
                      onClick={() => onDisconnectProvider(provider.providerId)}
                    >
                      Disconnect
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="settings-copy">No providers connected.</p>
          )}
          <p className="settings-copy">
            Disconnecting removes the provider from Overview and deletes its
            stored local history.
          </p>
        </section>

        <section className="danger-zone settings-surface" aria-labelledby="local-data-title">
          <h2 id="local-data-title">Delete all local data</h2>
          <p>
            Removes every connection, all retained history, and all settings
            from this browser. There is no cloud copy, so this cannot be undone.
          </p>
          {confirmDelete ? (
            <div className="delete-confirmation" role="group" aria-label="Confirm local data deletion">
              <p>This removes stored usage and disconnects every provider.</p>
              <div className="confirmation-actions">
                <button
                  className="button button--danger"
                  type="button"
                  aria-label="Confirm delete all local data"
                  autoFocus
                  onClick={() => {
                    onConfirmDeleteChange(false);
                    onDeleteLocalData();
                  }}
                >
                  Confirm delete
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  aria-label="Cancel delete all local data"
                  onClick={() => {
                    restoreDeleteFocus.current = true;
                    onConfirmDeleteChange(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={deleteTriggerRef}
              className="button button--danger danger-zone__trigger"
              type="button"
              onClick={() => onConfirmDeleteChange(true)}
            >
              Delete all local data
            </button>
          )}
        </section>

        <section className="settings-surface community-surface" aria-labelledby="community-title">
          <h2 id="community-title">Community &amp; support</h2>
          <OpenSourceFooter />
        </section>

        <p className="illustrative-note">
          AI Limits has no account and no cloud sync. Quota readings, history,
          and preferences live only in this browser profile.
        </p>
      </div>
    </section>
  );
}
