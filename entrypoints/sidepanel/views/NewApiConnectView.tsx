import React, { useState } from "react";

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

const feedbackByResult: Record<ApiKeyConnectAttemptResult, string> = {
  connected: "",
  invalid_site:
    "This site did not return compatible New API status and usage data. Check the URL and try again.",
  invalid_key: "Enter a valid relay key for this New API instance.",
  insufficient_scope:
    "This relay key could not read its usage. Check the key and any IP restrictions.",
  temporary_error:
    "New API could not be validated right now. Your existing data and key are unchanged.",
  permission_declined:
    "New API access was not changed. Allow access when you are ready to try again.",
};

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
  const title = replace ? "Replace New API connection" : "Connect New API";
  const submitLabel = replace ? "Validate & replace" : "Validate & connect";
  const invalid =
    baseUrl.trim().length === 0 || apiKey.trim().length === 0 || apiKey.length > 4_096;

  return (
    <section className="screen api-key-guide" aria-label={title}>
      <PageHeader
        title={title}
        subtitle={`${instanceLabel ? `${instanceLabel} · ` : ""}One instance · One relay key`}
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId="newapi" size="md" />
          <div>
            <h2>New API</h2>
            <p>Key-specific quota · Capped or unlimited</p>
          </div>
        </div>

        <p className="settings-copy">
          Each New API connection keeps its own relay key, label, usage, and
          history. It shows key-specific granted, used, and remaining quota.
          Unlimited keys show absolute usage without an invented percentage.
        </p>

        <form
          className="api-key-guide__form"
          aria-label="New API relay key setup"
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
              .then((result) => setFeedback(feedbackByResult[result]))
              .catch(() => setFeedback(feedbackByResult.temporary_error))
              .finally(() => {
                setApiKey("");
                setSubmitting(false);
              });
          }}
        >
          <label htmlFor="newapi-user-label">Instance label (optional)</label>
          <input
            id="newapi-user-label"
            type="text"
            autoComplete="off"
            maxLength={128}
            placeholder="Personal relay"
            value={userLabel}
            disabled={submitting}
            aria-describedby="newapi-user-label-help"
            onChange={(event) => setUserLabel(event.currentTarget.value)}
          />
          <small id="newapi-user-label-help">
            Used to distinguish this connection. If blank, AI Limits uses the
            reported account name or relay hostname.
          </small>

          <label htmlFor="newapi-base-url">New API site URL</label>
          <input
            id="newapi-base-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://new-api.example.com"
            value={baseUrl}
            disabled={submitting}
            aria-describedby="newapi-base-url-help"
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
          <small id="newapi-base-url-help">
            Paste the homepage, dashboard URL, or an API URL such as
            /v1/messages. AI Limits removes known console and API suffixes,
            then validates the instance through /api/status. HTTPS is required,
            except localhost for development.
          </small>

          <label htmlFor="newapi-api-key">New API relay key</label>
          <input
            id="newapi-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={submitting}
            aria-describedby="newapi-api-key-help"
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
          <small id="newapi-api-key-help">
            AI Limits calls only the read-only /api/usage/token/ endpoint and
            stores the key locally. The request is read-only, but the relay key
            itself may still call models; apply key limits in New API if needed.
          </small>

          <button
            className="button button--primary"
            type="submit"
            disabled={invalid || submitting}
            aria-busy={submitting}
          >
            {submitting ? "Validating…" : submitLabel}
          </button>
        </form>

        <p className="settings-copy">
          This mode does not read account wallet, subscriptions, admin data, or
          other relay keys. Each configured instance is read independently.
        </p>
        {feedback ? <p className="health-message">{feedback}</p> : null}
      </div>
    </section>
  );
}
