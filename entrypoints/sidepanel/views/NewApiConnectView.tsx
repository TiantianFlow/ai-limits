import React, { useState } from "react";

import { l10n } from "../../../i18n/index";
import { localizeProviderName } from "../../../i18n/presentation";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";
import type { ApiKeyConnectAttemptResult } from "./ApiKeyConnectView";

export interface NewApiConnectViewProps {
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

function feedbackFor(result: ApiKeyConnectAttemptResult): string {
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
  const title = replace
    ? l10n.t("newapi.replaceTitle")
    : l10n.t("newapi.connectTitle");
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
            ? l10n.t("newapi.subtitleNamed", { label: instanceLabel })
            : l10n.t("newapi.subtitle")
        }
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId="newapi" size="md" />
          <div>
            <h2>{localizeProviderName("newapi")}</h2>
            <p>{l10n.t("newapi.capabilities")}</p>
          </div>
        </div>

        <p className="settings-copy">{l10n.t("newapi.explanation")}</p>

        <form
          className="api-key-guide__form"
          aria-label={l10n.t("newapi.formName")}
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
              .then((result) => setFeedback(feedbackFor(result)))
              .catch(() => setFeedback(feedbackFor("temporary_error")))
              .finally(() => {
                setApiKey("");
                setSubmitting(false);
              });
          }}
        >
          <label htmlFor="newapi-user-label">{l10n.t("newapi.labelField")}</label>
          <input
            id="newapi-user-label"
            type="text"
            autoComplete="off"
            maxLength={128}
            placeholder={l10n.t("newapi.labelPlaceholder")}
            value={userLabel}
            disabled={submitting}
            aria-describedby="newapi-user-label-help"
            onChange={(event) => setUserLabel(event.currentTarget.value)}
          />
          <small id="newapi-user-label-help">{l10n.t("newapi.labelHelp")}</small>

          <label htmlFor="newapi-base-url">{l10n.t("newapi.urlField")}</label>
          <input
            id="newapi-base-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={l10n.t("newapi.urlPlaceholder")}
            value={baseUrl}
            disabled={submitting}
            aria-describedby="newapi-base-url-help"
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
          <small id="newapi-base-url-help">{l10n.t("newapi.urlHelp")}</small>

          <label htmlFor="newapi-api-key">{l10n.t("newapi.keyField")}</label>
          <input
            id="newapi-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={submitting}
            aria-describedby="newapi-api-key-help"
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
          <small id="newapi-api-key-help">{l10n.t("newapi.keyHelp")}</small>

          <button
            className="button button--primary"
            type="submit"
            disabled={invalid || submitting}
            aria-busy={submitting}
          >
            {submitting ? l10n.t("apiKey.validating") : submitLabel}
          </button>
        </form>

        <p className="settings-copy">{l10n.t("newapi.excluded")}</p>
        {feedback ? <p className="health-message">{feedback}</p> : null}
      </div>
    </section>
  );
}
