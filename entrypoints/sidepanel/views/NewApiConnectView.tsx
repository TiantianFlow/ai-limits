import React, { useState } from "react";

import { formatList } from "../../../i18n/format";
import { l10n } from "../../../i18n/index";
import {
  localizeCapability,
  localizeProviderName,
  providerCapabilityIds,
} from "../../../i18n/presentation";
import type { ApiKeyProviderKind } from "../../../domain/public-protocol";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";
import type { ApiKeyConnectAttemptResult } from "./ApiKeyConnectView";

export interface NewApiConnectViewProps {
  providerKind: ApiKeyProviderKind;
  guideKind?: "newapi";
  mode: "connect" | "replace";
  initialBaseUrl?: string;
  initialUserLabel?: string;
  instanceLabel?: string;
  backLabel: string;
  onBack: () => void;
  onSubmit: (
    baseUrl: string,
    apiKey: string,
    userLabel?: string,
  ) => Promise<ApiKeyConnectAttemptResult>;
}

function feedbackFor(
  result: ApiKeyConnectAttemptResult,
  providerKind: ApiKeyProviderKind,
  guideKind?: "newapi",
): string {
  if (guideKind !== "newapi") {
    const provider = localizeProviderName(providerKind);
    switch (result) {
      case "connected":
        return "";
      case "invalid_site":
        return l10n.t("dynamicApi.invalidSite", { provider });
      case "invalid_key":
        return l10n.t("dynamicApi.invalidKey", { provider });
      case "insufficient_scope":
        return l10n.t("dynamicApi.insufficientScope", { provider });
      case "temporary_error":
        return l10n.t("dynamicApi.temporary", { provider });
      case "permission_declined":
        return l10n.t("dynamicApi.permissionDeclined", { provider });
    }
  }

  switch (result) {
    case "connected":
      return "";
    case "invalid_site":
      return l10n.t("newapi.invalidSite");
    case "invalid_key":
      return l10n.t("newapi.invalidKey");
    case "insufficient_scope":
      return l10n.t("newapi.insufficientScope");
    case "temporary_error":
      return l10n.t("newapi.temporary");
    case "permission_declined":
      return l10n.t("newapi.permissionDeclined");
  }
}

export function NewApiConnectView({
  providerKind,
  guideKind,
  mode,
  initialBaseUrl = "",
  initialUserLabel = "",
  instanceLabel,
  backLabel,
  onBack,
  onSubmit,
}: NewApiConnectViewProps) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [userLabel, setUserLabel] = useState(initialUserLabel);
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const replace = mode === "replace";
  const isNewApi = guideKind === "newapi";
  const provider = localizeProviderName(providerKind);
  const capabilities = formatList(
    providerCapabilityIds(providerKind).map((id) =>
      localizeCapability(providerKind, id),
    ),
  );
  const fieldPrefix = `${providerKind}-connection`;
  const title = replace
    ? isNewApi
      ? l10n.t("newapi.replaceTitle")
      : l10n.t("dynamicApi.replaceTitle", { provider })
    : isNewApi
      ? l10n.t("newapi.connectTitle")
      : l10n.t("dynamicApi.connectTitle", { provider });
  const submitLabel = replace
    ? l10n.t("apiKey.submitReplace")
    : l10n.t("apiKey.submitConnect");
  const invalid =
    baseUrl.trim().length === 0 || apiKey.trim().length === 0 || apiKey.length > 4_096;

  return (
    <section className="screen api-key-guide" aria-label={title}>
      <PageHeader
        title={title}
        subtitle={
          instanceLabel
            ? isNewApi
              ? l10n.t("newapi.subtitleNamed", { label: instanceLabel })
              : l10n.t("dynamicApi.subtitleNamed", {
                  label: instanceLabel,
                  capabilities,
                })
            : isNewApi
              ? l10n.t("newapi.subtitle")
              : l10n.t("dynamicApi.subtitle", { capabilities })
        }
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId={providerKind} size="md" />
          <div>
            <h2>{provider}</h2>
            <p>{isNewApi ? l10n.t("newapi.capabilities") : capabilities}</p>
          </div>
        </div>

        <p className="settings-copy">
          {isNewApi
            ? l10n.t("newapi.explanation")
            : l10n.t("dynamicApi.explanation", { provider })}
        </p>

        <form
          className="api-key-guide__form"
          aria-label={
            isNewApi
              ? l10n.t("newapi.formName")
              : l10n.t("dynamicApi.formName", { provider })
          }
          onSubmit={(event) => {
            event.preventDefault();
            if (invalid || submitting) return;
            setSubmitting(true);
            setFeedback("");
            const trimmedLabel = userLabel.trim();
            const submission =
              replace || trimmedLabel
                ? onSubmit(baseUrl, apiKey, trimmedLabel)
                : onSubmit(baseUrl, apiKey);
            void submission
              .then((result) =>
                setFeedback(feedbackFor(result, providerKind, guideKind)),
              )
              .catch(() =>
                setFeedback(
                  feedbackFor("temporary_error", providerKind, guideKind),
                ),
              )
              .finally(() => {
                setApiKey("");
                setSubmitting(false);
              });
          }}
        >
          <label htmlFor={`${fieldPrefix}-user-label`}>
            {l10n.t("newapi.labelField")}
          </label>
          <input
            id={`${fieldPrefix}-user-label`}
            type="text"
            autoComplete="off"
            maxLength={128}
            placeholder={
              isNewApi
                ? l10n.t("newapi.labelPlaceholder")
                : l10n.t("dynamicApi.labelPlaceholder", { provider })
            }
            value={userLabel}
            disabled={submitting}
            aria-describedby={`${fieldPrefix}-user-label-help`}
            onChange={(event) => setUserLabel(event.currentTarget.value)}
          />
          <small id={`${fieldPrefix}-user-label-help`}>
            {l10n.t("newapi.labelHelp")}
          </small>

          <label htmlFor={`${fieldPrefix}-base-url`}>
            {isNewApi
              ? l10n.t("newapi.urlField")
              : l10n.t("dynamicApi.urlField", { provider })}
          </label>
          <input
            id={`${fieldPrefix}-base-url`}
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={
              isNewApi
                ? l10n.t("newapi.urlPlaceholder")
                : l10n.t("dynamicApi.urlPlaceholder")
            }
            value={baseUrl}
            disabled={submitting}
            aria-describedby={`${fieldPrefix}-base-url-help`}
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
          <small id={`${fieldPrefix}-base-url-help`}>
            {isNewApi
              ? l10n.t("newapi.urlHelp")
              : l10n.t("dynamicApi.urlHelp", { provider })}
          </small>

          <label htmlFor={`${fieldPrefix}-api-key`}>
            {isNewApi
              ? l10n.t("newapi.keyField")
              : l10n.t("dynamicApi.keyField", { provider })}
          </label>
          <input
            id={`${fieldPrefix}-api-key`}
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={submitting}
            aria-describedby={`${fieldPrefix}-api-key-help`}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
          <small id={`${fieldPrefix}-api-key-help`}>
            {isNewApi
              ? l10n.t("newapi.keyHelp")
              : l10n.t("dynamicApi.keyHelp")}
          </small>

          <button
            className="button button--primary"
            type="submit"
            disabled={invalid || submitting}
            aria-busy={submitting}
          >
            {submitting ? l10n.t("apiKey.validating") : submitLabel}
          </button>
        </form>

        <p className="settings-copy">
          {isNewApi ? l10n.t("newapi.excluded") : l10n.t("dynamicApi.excluded")}
        </p>
        {feedback ? <p className="health-message">{feedback}</p> : null}
      </div>
    </section>
  );
}
