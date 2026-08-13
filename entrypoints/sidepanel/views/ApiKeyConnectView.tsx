import React, { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

export type ApiKeyConnectAttemptResult =
  | "connected"
  | "invalid_key"
  | "insufficient_scope"
  | "temporary_error"
  | "permission_declined";

export interface ApiKeyConnectViewProps {
  mode: "connect" | "replace";
  backLabel: string;
  onBack: () => void;
  onOpenSetup: () => void;
  onSubmit: (apiKey: string) => Promise<ApiKeyConnectAttemptResult>;
}

const feedbackByResult: Record<ApiKeyConnectAttemptResult, string> = {
  connected: "",
  invalid_key: "Enter a valid ElevenLabs API key.",
  insufficient_scope:
    "Allow User → Read and check any IP restrictions, then try again.",
  temporary_error:
    "ElevenLabs could not be validated right now. Your existing data and key are unchanged.",
  permission_declined:
    "ElevenLabs access was not changed. Allow access when you are ready to try again.",
};

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
  const submitLabel = replace ? "Validate & replace" : "Validate & connect";
  const title = replace ? "Replace ElevenLabs API key" : "Connect ElevenLabs";
  const invalidLength = apiKey.trim().length === 0 || apiKey.length > 4_096;

  return (
    <section className="screen api-key-guide" aria-label={title}>
      <PageHeader
        title={title}
        subtitle="Read-only subscription usage"
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId="elevenlabs" size="md" />
          <div>
            <h2>ElevenLabs</h2>
            <p>Monthly credits · Voice limits</p>
          </div>
        </div>

        <ol className="api-key-guide__steps">
          <li>
            <span className="api-key-guide__number" aria-hidden="true">1</span>
            <div>
              <h3>Open the ElevenLabs API keys page</h3>
              <p>Sign in first if ElevenLabs asks you to, then reopen the page.</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={onOpenSetup}
              >
                Open API keys page
              </button>
            </div>
          </li>
          <li>
            <span className="api-key-guide__number" aria-hidden="true">2</span>
            <div>
              <h3>Create a key named AI Limits</h3>
              <p>
                Select <strong>User → Read</strong>. Leave generation and write
                permissions off. ElevenLabs does not publish the exact
                endpoint-to-scope mapping, so validation confirms access.
              </p>
            </div>
          </li>
          <li>
            <span className="api-key-guide__number" aria-hidden="true">3</span>
            <div>
              <h3>Paste the key and validate</h3>
              <form
                className="api-key-guide__form"
                aria-label="ElevenLabs API key setup"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (invalidLength || submitting) return;
                  setSubmitting(true);
                  setFeedback("");
                  void onSubmit(apiKey)
                    .then((result) => setFeedback(feedbackByResult[result]))
                    .catch(() => setFeedback(feedbackByResult.temporary_error))
                    .finally(() => {
                      setApiKey("");
                      setSubmitting(false);
                    });
                }}
              >
                <label htmlFor="elevenlabs-api-key">ElevenLabs API key</label>
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
                  Saved locally and never shown again in AI Limits.
                </small>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={invalidLength || submitting}
                  aria-busy={submitting}
                >
                  {submitting ? "Validating…" : submitLabel}
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
