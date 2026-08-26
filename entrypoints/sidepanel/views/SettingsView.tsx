import type { Ref } from "react";
import React, { useEffect, useRef, useState } from "react";

import {
  isSupportedLocale,
  l10n,
  localeDisplayName,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "../../../i18n/index";
import {
  localizeConnectionDisclosure,
  localizeManualRefreshDisclosure,
  localizePlanLabel,
  localizeProviderName,
} from "../../../i18n/presentation";
import {
  type ApiKeyProviderKind,
  type ProviderInstanceId,
  type ProviderInstanceView,
  type ProviderAvailabilityView,
  type ProviderKind,
} from "../../../domain/public-protocol";
import { instanceLabels } from "../instance-label";
import { Icon } from "../components/Icon";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

export interface SettingsViewProps {
  autoRefresh: boolean;
  autoRefreshPending: boolean;
  localeOverride?: SupportedLocale;
  instances: ProviderInstanceView[];
  providers: ProviderAvailabilityView[];
  now: number;
  confirmDelete: boolean;
  addProviderButtonRef: Ref<HTMLButtonElement>;
  closeLabel?: string;
  onClose: () => void;
  onAddProvider: () => void;
  onAutoRefreshChange: (enabled: boolean) => void;
  onLocaleOverrideChange: (locale: SupportedLocale | undefined) => void;
  onReconnectProvider: (providerKind: ProviderKind) => void;
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
    return l10n.t("freshness.noSuccessfulRead");
  }

  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
  if (minutes < 1) {
    return l10n.t("freshness.updatedJustNow");
  }

  return l10n.t("freshness.updatedAge", {
    age: l10n.count("freshness.minutesAgo", minutes),
  });
}

export function SettingsView({
  autoRefresh,
  autoRefreshPending,
  localeOverride,
  instances,
  providers,
  now,
  confirmDelete,
  addProviderButtonRef,
  closeLabel = l10n.t("common.overview"),
  onClose,
  onAddProvider,
  onAutoRefreshChange,
  onLocaleOverrideChange,
  onReconnectProvider,
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
  const [confirmDisconnectId, setConfirmDisconnectId] =
    useState<ProviderInstanceId>();
  const disconnectTriggerRefs = useRef<
    Partial<Record<ProviderInstanceId, HTMLButtonElement | null>>
  >({});
  const restoreDisconnectFocus = useRef<ProviderInstanceId | undefined>(
    undefined,
  );
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

  useEffect(() => {
    if (
      confirmDisconnectId &&
      !instances.some((instance) => instance.id === confirmDisconnectId)
    ) {
      setConfirmDisconnectId(undefined);
    }
  }, [confirmDisconnectId, instances]);

  useEffect(() => {
    if (!confirmDisconnectId && restoreDisconnectFocus.current) {
      const instanceId = restoreDisconnectFocus.current;
      restoreDisconnectFocus.current = undefined;
      disconnectTriggerRefs.current[instanceId]?.focus();
    }
  }, [confirmDisconnectId]);

  return (
    <section className="screen settings-panel" aria-label={l10n.t("settings.screen")}>
      <PageHeader
        title={l10n.t("settings.title")}
        subtitle={l10n.t("settings.subtitle")}
        backLabel={closeLabel}
        onBack={onClose}
      />

      <div className="settings-screen screen-body">
        <section className="settings-surface" aria-labelledby="language-title">
          <div className="settings-language">
            <span className="settings-toggle__copy">
              <strong id="language-title">{l10n.t("settings.language")}</strong>
              <small>{l10n.t("settings.languageDescription")}</small>
            </span>
            <select
              className="settings-language__select"
              aria-label={l10n.t("settings.language")}
              value={localeOverride ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                onLocaleOverrideChange(
                  isSupportedLocale(value) ? value : undefined,
                );
              }}
            >
              <option value="">
                {l10n.t("settings.languageFollowChrome")}
              </option>
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {localeDisplayName(locale)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="settings-surface" aria-labelledby="automatic-refresh-title">
          <label className="settings-toggle">
            <span className="settings-toggle__copy">
              <strong id="automatic-refresh-title">
                {l10n.t("settings.automaticRefresh")}
              </strong>
              <small>{l10n.t("settings.automaticRefreshDescription")}</small>
            </span>
            <span className="settings-toggle__control">
              <input
                type="checkbox"
                role="switch"
                aria-label={l10n.t("settings.automaticRefresh")}
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
              ? l10n.t("settings.automaticOn")
              : l10n.t("settings.automaticOff")}
          </p>
        </section>

        <section className="settings-surface" aria-labelledby="connected-providers-title">
          <div className="settings-surface__heading">
            <h2 id="connected-providers-title">
              {l10n.t("settings.connectedProviders")}
            </h2>
            <button
              ref={addProviderButtonRef}
              className="settings-add-action"
              type="button"
              onClick={onAddProvider}
            >
              <span aria-hidden="true">+</span>
              {l10n.t("common.addProvider")}
            </button>
          </div>
          {instances.length ? (
            <ul className="settings-provider-list">
              {instances.map((instance) => {
                const name = localizeProviderName(instance.providerKind);
                const label = labelsByInstance.get(instance.id)!;
                const usesApiKey = providers.find(
                  (provider) => provider.providerKind === instance.providerKind,
                )?.credentialKind === "api-key";
                const connectionMethod = usesApiKey
                  ? l10n.t("common.apiKey")
                  : l10n.t("common.browserSession");
                const planLabel = localizePlanLabel(
                  instance.providerKind,
                  instance.snapshot?.planLabel,
                );
                const editing = renamingInstanceId === instance.id;
                const confirmingDisconnect = confirmDisconnectId === instance.id;
                const inputId = `settings-label-${instance.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                return (
                  <li
                    key={instance.id}
                    className={
                      editing
                        ? "settings-provider-row--renaming"
                        : confirmingDisconnect
                          ? "settings-provider-row--disconnecting"
                          : undefined
                    }
                    aria-label={l10n.t("settings.instanceSettings", { label })}
                  >
                    <ProviderMark providerId={instance.providerKind} size="sm" />
                    <div className="settings-provider-content">
                      <div className="settings-provider-copy">
                        <p
                          role="heading"
                          aria-level={3}
                          aria-label={
                            label === name
                              ? name
                              : l10n.t("settings.identityNamed", {
                                  provider: name,
                                  label,
                                })
                          }
                        >
                          <strong>{name}</strong>
                          {label !== name ? (
                            <span className="settings-provider-copy__instance">{label}</span>
                          ) : null}
                        </p>
                        <small>
                          {l10n.t("settings.freshnessMethod", {
                            freshness: freshness(instance, now),
                            method: connectionMethod,
                            readOnly: l10n.t("common.readOnly"),
                          })}
                        </small>
                        {planLabel ? (
                          <small>{planLabel}</small>
                        ) : null}
                        {usesApiKey ? (
                          <small>{l10n.t("settings.apiKeySaved")}</small>
                        ) : null}
                        <small>
                          {localizeConnectionDisclosure(instance.providerKind)}
                        </small>
                        {localizeManualRefreshDisclosure(instance.providerKind) ? (
                          <small>
                            {localizeManualRefreshDisclosure(instance.providerKind)}
                          </small>
                        ) : null}
                      </div>
                      <div className="settings-provider-actions">
                        {editing ? (
                          <div className="settings-rename" role="group" aria-label={l10n.t("settings.renameGroup", { label })}>
                            <label htmlFor={inputId}>{l10n.t("settings.instanceLabel")}</label>
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
                              aria-label={l10n.t("settings.saveLabelNamed", { label })}
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
                                        l10n.t("settings.renameFailed"),
                                      );
                                      return;
                                    }
                                    restoreRenameFocus.current = instance.id;
                                    setRenamingInstanceId(undefined);
                                  })
                                  .catch(() => {
                                    restoreRenameInputFocus.current = true;
                                    setRenameError(l10n.t("settings.renameFailed"));
                                  })
                                  .finally(() => setRenamePending(false));
                              }}
                            >
                              <span aria-hidden="true">{l10n.t("common.save")}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={l10n.t("settings.cancelRenameNamed", { label })}
                              disabled={renamePending}
                              onClick={() => {
                                restoreRenameInputFocus.current = false;
                                setRenameError("");
                                restoreRenameFocus.current = instance.id;
                                setRenamingInstanceId(undefined);
                              }}
                            >
                              <span aria-hidden="true">{l10n.t("common.cancel")}</span>
                            </button>
                            {renamePending ? (
                              <p className="settings-rename__feedback" role="status">
                                {l10n.t("settings.renaming")}
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
                            aria-label={l10n.t("settings.renameNamed", { label })}
                            data-focus-key={`settings-rename-${instance.id}`}
                            onClick={() => {
                              restoreRenameInputFocus.current = false;
                              setRenameError("");
                              setLabelDraft(instance.userLabel ?? "");
                              setConfirmDisconnectId(undefined);
                              setRenamingInstanceId(instance.id);
                            }}
                          >
                            <span aria-hidden="true">{l10n.t("common.rename")}</span>
                          </button>
                        )}
                        {usesApiKey ? (
                          <button
                            type="button"
                            aria-label={l10n.t("settings.replaceKeyNamed", { label })}
                            data-focus-key={`settings-replace-api-key-${instance.id}`}
                            onClick={() =>
                              onReplaceApiKey(
                                instance.providerKind as ApiKeyProviderKind,
                                instance.id,
                              )
                            }
                          >
                            <span aria-hidden="true">{l10n.t("common.replaceKey")}</span>
                          </button>
                        ) : null}
                        {!usesApiKey && instance.access === "required" ? (
                          <button
                            type="button"
                            aria-label={l10n.t("settings.reconnectNamed", { label })}
                            data-focus-key={`settings-reconnect-${instance.id}`}
                            onClick={() =>
                              onReconnectProvider(instance.providerKind)
                            }
                          >
                            <span aria-hidden="true">{l10n.t("common.reconnect")}</span>
                          </button>
                        ) : null}
                        {confirmingDisconnect ? null : (
                          <button
                            ref={(element) => {
                              disconnectTriggerRefs.current[instance.id] = element;
                            }}
                            type="button"
                            aria-label={l10n.t("settings.disconnectNamed", { label })}
                            data-focus-key={`settings-disconnect-${instance.id}`}
                            className="settings-provider-actions__disconnect"
                            onClick={() => {
                              setRenamingInstanceId(undefined);
                              setConfirmDisconnectId(instance.id);
                            }}
                          >
                            <span aria-hidden="true">{l10n.t("common.disconnect")}</span>
                          </button>
                        )}
                      </div>
                      {confirmingDisconnect ? (
                        <div
                          className="delete-confirmation settings-disconnect-confirm"
                          role="group"
                          aria-label={l10n.t("providerDetail.disconnectConfirmGroup")}
                        >
                          <p>{l10n.t("providerDetail.disconnectConfirmWarning")}</p>
                          <div className="confirmation-actions">
                            <button
                              className="button button--danger"
                              type="button"
                              aria-label={l10n.t(
                                "providerDetail.disconnectConfirmNamed",
                                { label },
                              )}
                              autoFocus
                              onClick={() => onDisconnectInstance(instance.id)}
                            >
                              {l10n.t("providerDetail.disconnectConfirm")}
                            </button>
                            <button
                              className="button button--secondary"
                              type="button"
                              aria-label={l10n.t(
                                "providerDetail.disconnectCancelNamed",
                                { label },
                              )}
                              onClick={() => {
                                restoreDisconnectFocus.current = instance.id;
                                setConfirmDisconnectId(undefined);
                              }}
                            >
                              {l10n.t("common.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="settings-copy">{l10n.t("settings.noProviders")}</p>
          )}
          <p className="settings-copy">
            {l10n.t("settings.disconnectExplanation")}
          </p>
        </section>

        <section className="danger-zone settings-surface" aria-labelledby="local-data-title">
          <h2 id="local-data-title">{l10n.t("settings.deleteTitle")}</h2>
          <p>{l10n.t("settings.deleteExplanation")}</p>
          {confirmDelete ? (
            <div className="delete-confirmation" role="group" aria-label={l10n.t("settings.confirmGroup")}>
              <p>{l10n.t("settings.confirmWarning")}</p>
              <div className="confirmation-actions">
                <button
                  className="button button--danger"
                  type="button"
                  aria-label={l10n.t("settings.confirmDeleteNamed")}
                  autoFocus
                  onClick={() => {
                    onConfirmDeleteChange(false);
                    onDeleteLocalData();
                  }}
                >
                  {l10n.t("settings.confirmDelete")}
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  aria-label={l10n.t("settings.cancelDeleteNamed")}
                  onClick={() => {
                    restoreDeleteFocus.current = true;
                    onConfirmDeleteChange(false);
                  }}
                >
                  {l10n.t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={deleteTriggerRef}
              className="button button--danger-outline danger-zone__trigger"
              type="button"
              aria-label={l10n.t("settings.deleteAll")}
              onClick={() => onConfirmDeleteChange(true)}
            >
              <span className="danger-zone__trigger-surface">
                <Icon name="trash" />
                {l10n.t("settings.deleteAll")}
              </span>
            </button>
          )}
        </section>

        <section className="settings-surface community-surface" aria-labelledby="community-title">
          <h2 id="community-title">{l10n.t("settings.community")}</h2>
          <OpenSourceFooter />
        </section>

        <p className="illustrative-note">
          {l10n.t("settings.localOnlyNote")}
        </p>
      </div>
    </section>
  );
}
