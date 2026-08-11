import React from "react";
import { createRoot } from "react-dom/client";

import { Cockpit } from "../../entrypoints/sidepanel/Cockpit";
import "../../entrypoints/sidepanel/styles.css";
import { createFixtureState } from "../../providers/fixtures";
import {
  parsePreviewLanguage,
  previewContent,
  type PreviewView,
} from "./copy";
import "./styles.css";

const CAPTURE_NOW = Date.parse("2026-08-09T14:00:00.000Z");
const state = createFixtureState(CAPTURE_NOW);

function parseView(parameters: URLSearchParams): PreviewView {
  const candidate = parameters.get("view");
  return candidate === "pacing" ||
    candidate === "privacy" ||
    candidate === "promo"
    ? candidate
    : "overview";
}

function FeatureNotes({
  view,
  pacingNotes,
  privacyNotes,
}: {
  view: PreviewView;
  pacingNotes: [string, string, string];
  privacyNotes: [string, string, string];
}) {
  if (view === "pacing") {
    return (
      <div className="feature-notes" aria-hidden="true">
        {pacingNotes.map((note) => (
          <span key={note}>{note}</span>
        ))}
      </div>
    );
  }

  if (view === "privacy") {
    return (
      <ul className="privacy-notes">
        {privacyNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    );
  }

  if (view === "overview") {
    return (
      <p className="provider-line">ChatGPT · Claude · Kimi · Cursor</p>
    );
  }

  return null;
}

function ExtensionPreview({
  chromeSidePanelLabel,
}: {
  chromeSidePanelLabel: string;
}) {
  return (
    <div className="extension-frame">
      <div className="extension-frame__bar" aria-hidden="true">
        <span className="extension-frame__dot" />
        <span>AI Limits</span>
        <span className="extension-frame__chrome">{chromeSidePanelLabel}</span>
      </div>
      <div className="panel-frame" data-panel-frame>
        <Cockpit
          state={state}
          now={CAPTURE_NOW}
          onDisplayModeChange={() => undefined}
          onRefresh={() => undefined}
          onConnectProvider={() => undefined}
        />
      </div>
    </div>
  );
}

function Preview() {
  const parameters = new URLSearchParams(window.location.search);
  const view = parseView(parameters);
  const language = parsePreviewLanguage(parameters);
  const content = previewContent[language];
  const copy = content[view];

  return (
    <main
      className={`capture-page capture-page--${view}`}
      data-preview-ready
      lang={language === "zh_CN" ? "zh-CN" : "en"}
    >
      <section className="marketing-copy">
        <div className="brand-lockup">
          <img src="/icons/128.png" width="56" height="56" alt="" />
          <span>AI Limits</span>
        </div>
        <p className="marketing-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="marketing-description">{copy.description}</p>
        <FeatureNotes
          view={view}
          pacingNotes={content.pacingNotes}
          privacyNotes={content.privacyNotes}
        />
      </section>

      <section
        className="product-stage"
        aria-label={content.productPreviewLabel}
      >
        {view !== "promo" ? (
          <p className="representative-label">{content.representativeLabel}</p>
        ) : null}
        <ExtensionPreview chromeSidePanelLabel={content.chromeSidePanelLabel} />
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Store artwork preview root is missing.");
}

createRoot(root).render(<Preview />);
