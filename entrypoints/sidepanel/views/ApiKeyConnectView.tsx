import React, { useState } from "react";

import { l10n } from "../../../i18n/index";
import { localizeProviderName } from "../../../i18n/presentation";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

export type ApiKeyConnectAttemptResult =
  | "connected"
  | "invalid_key"
  | "insufficient_scope"
  | "invalid_site"
  | "temporary_error"
  | "permission_declined";

export interface ApiKeyConnectViewProps {
  mode: "connect" | "replace";
  backLabel: string;
  onBack: () => void;
  onOpenSetup: () => void;
  onSubmit: (apiKey: string) => Promise<ApiKeyConnectAttemptResult>;
}

function feedbackFor(result: ApiKeyConnectAttemptResult): string {
  switch (result) {
    case "connected":
      return "";
    case "invalid_key":
      return l10n.t("apiKey.invalidKey");
    case "insufficient_scope":
      return l10n.t("apiKey.insufficientScope");
    case "invalid_site":
      return l10n.t("apiKey.invalidSite");
    case "temporary_error":
      return l10n.t("apiKey.temporary");
    case "permission_declined":
      return l10n.t("apiKey.permissionDeclined");
  }
}

export function ApiKeyConnectView({
  mode,
  backLabel,
  onBack,
  onOpenSetup,
  onSubmit,
}: ApiKeyConnectViewProps) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const replace = mode === "replace";
  const submitLabel = replace
    ? l10n.t("apiKey.submitReplace")
    : l10n.t("apiKey.submitConnect");
  const title = replace
    ? l10n.t("apiKey.replaceTitle")
    : l10n.t("apiKey.connectTitle");
  const invalidLength = apiKey.trim().length === 0 || apiKey.length > 4_096;

  return (
    <section className="screen api-key-guide" aria-label={title}>
      <PageHeader
        title={title}
        subtitle={l10n.t("apiKey.subtitle")}
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId="elevenlabs" size="md" />
          <div>
            <h2>{localizeProviderName("elevenlabs")}</h2>
            <p>{l10n.t("apiKey.capabilities")}</p>
          </div>
        </div>

        <ol className="api-key-guide__steps">
          <li>
            <span className="api-key-guide__number" aria-hidden="true">1</span>
            <div>
              <h3>{l10n.t("apiKey.step1Title")}</h3>
              <p>{l10n.t("apiKey.step1Copy")}</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={onOpenSetup}
              >
                {l10n.t("apiKey.openKeysPage")}
              </button>
            </div>
          </li>
          <li>
            <span className="api-key-guide__number" aria-hidden="true">2</span>
            <div>
              <h3>{l10n.t("apiKey.step2Title")}</h3>
              <p>
                {l10n.t("apiKey.step2Prefix")}{" "}
                <strong>User → Read</strong>
                {l10n.t("apiKey.step2Suffix")}
              </p>
            </div>
          </li>
          <li>
            <span className="api-key-guide__number" aria-hidden="true">3</span>
            <div>
              <h3>{l10n.t("apiKey.step3Title")}</h3>
              <form
                className="api-key-guide__form"
                aria-label={l10n.t("apiKey.formName")}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (invalidLength || submitting) return;
                  setSubmitting(true);
                  setFeedback("");
                  void onSubmit(apiKey)
                    .then((result) => setFeedback(feedbackFor(result)))
                    .catch(() => setFeedback(feedbackFor("temporary_error")))
                    .finally(() => {
                      setApiKey("");
                      setSubmitting(false);
                    });
                }}
              >
                <label htmlFor="elevenlabs-api-key">{l10n.t("apiKey.fieldLabel")}</label>
                <input
                  id="elevenlabs-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  disabled={submitting}
                  aria-describedby="elevenlabs-api-key-help"
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                />
                <small id="elevenlabs-api-key-help">
                  {l10n.t("apiKey.fieldHelp")}
                </small>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={invalidLength || submitting}
                  aria-busy={submitting}
                >
                  {submitting ? l10n.t("apiKey.validating") : submitLabel}
                </button>
              </form>
            </div>
          </li>
        </ol>

        {feedback ? <p className="health-message">{feedback}</p> : null}
      </div>
    </section>
  );
}
