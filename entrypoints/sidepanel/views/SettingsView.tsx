import type { Ref } from "react";
import React, { useEffect, useRef, useState } from "react";

import type { ProviderInstanceView } from "../../../domain/public-protocol";
import type { ProviderInstanceId } from "../../../domain/model";
import {
  type ApiKeyProviderKind,
  providerCatalog,
  providerNames,
  providerPresentation,
} from "../../../providers/catalog";
import { instanceLabels } from "../instance-label";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

export interface SettingsViewProps {
  autoRefresh: boolean;
  autoRefreshPending: boolean;
  instances: ProviderInstanceView[];
  now: number;
  confirmDelete: boolean;
  addProviderButtonRef: Ref<HTMLButtonElement>;
  closeLabel?: string;
  onClose: () => void;
  onAddProvider: () => void;
  onAutoRefreshChange: (enabled: boolean) => void;
  onDisconnectInstance: (instanceId: ProviderInstanceId) => void;
  onReplaceApiKey: (
    providerKind: ApiKeyProviderKind,
    instanceId: ProviderInstanceId,
  ) => void;
  onRenameInstance: (
    instanceId: ProviderInstanceId,
    userLabel?: string,
  ) => Promise<boolean>;
  onDeleteLocalData: () => void;
  onConfirmDeleteChange: (confirm: boolean) => void;
}

function freshness(instance: ProviderInstanceView, now: number): string {
  const fetchedAt = instance.snapshot?.fetchedAt;
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
  instances,
  now,
  confirmDelete,
  addProviderButtonRef,
  closeLabel = "Overview",
  onClose,
  onAddProvider,
  onAutoRefreshChange,
  onDisconnectInstance,
  onReplaceApiKey,
  onRenameInstance,
  onDeleteLocalData,
  onConfirmDeleteChange,
}: SettingsViewProps) {
  const [renamingInstanceId, setRenamingInstanceId] =
    useState<ProviderInstanceId>();
  const [labelDraft, setLabelDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState("");
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocus = useRef(false);
  const renameTriggerRefs = useRef<
    Partial<Record<ProviderInstanceId, HTMLButtonElement | null>>
  >({});
  const restoreRenameFocus = useRef<ProviderInstanceId | undefined>(undefined);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const restoreRenameInputFocus = useRef(false);
  const labelsByInstance = instanceLabels(instances);

  useEffect(() => {
    if (!confirmDelete && restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmDelete]);

  useEffect(() => {
    if (!renamingInstanceId && restoreRenameFocus.current) {
      const instanceId = restoreRenameFocus.current;
      restoreRenameFocus.current = undefined;
      renameTriggerRefs.current[instanceId]?.focus();
    }
  }, [renamingInstanceId]);

  useEffect(() => {
    if (!renamePending && renameError && restoreRenameInputFocus.current) {
      restoreRenameInputFocus.current = false;
      renameInputRef.current?.focus();
    }
  }, [renameError, renamePending]);

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
          {instances.length ? (
            <ul className="settings-provider-list">
              {instances.map((instance) => {
                const name = providerNames[instance.providerKind];
                const label = labelsByInstance.get(instance.id)!;
                const presentation = providerPresentation(instance.providerKind);
                const connectionMethod =
                  providerCatalog[instance.providerKind].connection.kind === "api-key"
                    ? "API key"
                    : "Browser session";
                const editing = renamingInstanceId === instance.id;
                const inputId = `settings-label-${instance.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                return (
                  <li
                    key={instance.id}
                    className={editing ? "settings-provider-row--renaming" : undefined}
                    aria-label={`${label} settings`}
                  >
                    <ProviderMark providerId={instance.providerKind} size="sm" />
                    <div className="settings-provider-copy">
                      <p
                        role="heading"
                        aria-level={3}
                        aria-label={label === name ? name : `${name} · ${label}`}
                      >
                        <strong>{name}</strong>
                        {label !== name ? (
                          <span className="settings-provider-copy__instance">{label}</span>
                        ) : null}
                      </p>
                      <small>
                        {freshness(instance, now)} · {connectionMethod} · read-only
                      </small>
                      {instance.snapshot?.planLabel ? (
                        <small>{instance.snapshot.planLabel}</small>
                      ) : null}
                      {providerCatalog[instance.providerKind].connection.kind ===
                      "api-key" ? (
                        <small>API key saved</small>
                      ) : null}
                      <small>{presentation.connectionDisclosure}</small>
                      {presentation.manualRefreshDisclosure ? (
                        <small>{presentation.manualRefreshDisclosure}</small>
                      ) : null}
                    </div>
                    <div className="settings-provider-actions">
                      {editing ? (
                        <div className="settings-rename" role="group" aria-label={`Rename ${label}`}>
                          <label htmlFor={inputId}>Instance label</label>
                          <input
                            ref={renameInputRef}
                            id={inputId}
                            type="text"
                            maxLength={128}
                            value={labelDraft}
                            disabled={renamePending}
                            autoFocus
                            onChange={(event) => {
                              setLabelDraft(event.currentTarget.value);
                              setRenameError("");
                            }}
                          />
                          <button
                            type="button"
                            aria-label={`Save label for ${label}`}
                            aria-busy={renamePending}
                            disabled={renamePending}
                            onClick={() => {
                              const trimmed = labelDraft.trim();
                              setRenamePending(true);
                              setRenameError("");
                              void onRenameInstance(
                                instance.id,
                                trimmed || undefined,
                              )
                                .then((success) => {
                                  if (!success) {
                                    restoreRenameInputFocus.current = true;
                                    setRenameError(
                                      "Couldn’t rename this connection. Try again.",
                                    );
                                    return;
                                  }
                                  restoreRenameFocus.current = instance.id;
                                  setRenamingInstanceId(undefined);
                                })
                                .catch(() => {
                                  restoreRenameInputFocus.current = true;
                                  setRenameError(
                                    "Couldn’t rename this connection. Try again.",
                                  );
                                })
                                .finally(() => setRenamePending(false));
                            }}
                          >
                            <span aria-hidden="true">Save</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Cancel renaming ${label}`}
                            disabled={renamePending}
                            onClick={() => {
                              restoreRenameInputFocus.current = false;
                              setRenameError("");
                              restoreRenameFocus.current = instance.id;
                              setRenamingInstanceId(undefined);
                            }}
                          >
                            <span aria-hidden="true">Cancel</span>
                          </button>
                          {renamePending ? (
                            <p className="settings-rename__feedback" role="status">
                              Renaming…
                            </p>
                          ) : renameError ? (
                            <p className="settings-rename__feedback" role="alert">
                              {renameError}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          ref={(element) => {
                            renameTriggerRefs.current[instance.id] = element;
                          }}
                          type="button"
                          aria-label={`Rename ${label}`}
                          data-focus-key={`settings-rename-${instance.id}`}
                          onClick={() => {
                            restoreRenameInputFocus.current = false;
                            setRenameError("");
                            setLabelDraft(instance.userLabel ?? "");
                            setRenamingInstanceId(instance.id);
                          }}
                        >
                          <span aria-hidden="true">Rename</span>
                        </button>
                      )}
                      {providerCatalog[instance.providerKind].connection.kind === "api-key" ? (
                        <button
                          type="button"
                          aria-label={`Replace ${label} API key`}
                          data-focus-key={`settings-replace-api-key-${instance.id}`}
                          onClick={() =>
                            onReplaceApiKey(
                              instance.providerKind as ApiKeyProviderKind,
                              instance.id,
                            )
                          }
                        >
                          <span aria-hidden="true">Replace key</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Disconnect ${label}`}
                        data-focus-key={`settings-disconnect-${instance.id}`}
                        onClick={() => onDisconnectInstance(instance.id)}
                      >
                        <span aria-hidden="true">Disconnect</span>
                      </button>
                    </div>
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
