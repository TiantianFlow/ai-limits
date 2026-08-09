import React from "react";
import { createRoot } from "react-dom/client";

import { Cockpit } from "../../entrypoints/sidepanel/Cockpit";
import "../../entrypoints/sidepanel/styles.css";
import { createFixtureState } from "../../providers/fixtures";
import "./styles.css";

const CAPTURE_NOW = Date.parse("2026-08-09T14:00:00.000Z");
const state = createFixtureState(CAPTURE_NOW);

type PreviewView = "overview" | "pacing" | "privacy" | "promo";

const viewCopy: Record<
  PreviewView,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "One Chrome side panel",
    title: "Every AI limit, in one quiet view.",
    description:
      "See subscription usage, reset timing, and plan details without hopping between account pages.",
  },
  pacing: {
    eyebrow: "Plan your usage",
    title: "Know the limit. See the pace.",
    description:
      "Quota and time bars sit together, so bursts, reset windows, and remaining headroom are easy to scan.",
  },
  privacy: {
    eyebrow: "Local by design",
    title: "Clear controls for private account data.",
    description:
      "Connect providers individually, control automatic refresh, disconnect at any time, or delete all local data.",
  },
  promo: {
    eyebrow: "Chrome side panel",
    title: "AI limits, at a glance.",
    description: "Usage and reset timing for your AI subscriptions.",
  },
};

function parseView(): PreviewView {
  const candidate = new URLSearchParams(window.location.search).get("view");
  return candidate === "pacing" ||
    candidate === "privacy" ||
    candidate === "promo"
    ? candidate
    : "overview";
}

function FeatureNotes({ view }: { view: PreviewView }) {
  if (view === "pacing") {
    return (
      <div className="feature-notes" aria-hidden="true">
        <span>Quota used</span>
        <span>Time elapsed</span>
        <span>Pace signal</span>
      </div>
    );
  }

  if (view === "privacy") {
    return (
      <ul className="privacy-notes">
        <li>Provider access is opt-in</li>
        <li>Normalized usage stays local</li>
        <li>No analytics or remote backend</li>
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

function ExtensionPreview({ view }: { view: PreviewView }) {
  return (
    <div className="extension-frame">
      <div className="extension-frame__bar" aria-hidden="true">
        <span className="extension-frame__dot" />
        <span>AI Limits</span>
        <span className="extension-frame__chrome">Chrome side panel</span>
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
  const view = parseView();
  const copy = viewCopy[view];

  return (
    <main className={`capture-page capture-page--${view}`} data-preview-ready>
      <section className="marketing-copy">
        <div className="brand-lockup">
          <img src="/icons/128.png" width="56" height="56" alt="" />
          <span>AI Limits</span>
        </div>
        <p className="marketing-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="marketing-description">{copy.description}</p>
        <FeatureNotes view={view} />
      </section>

      <section className="product-stage" aria-label="AI Limits product preview">
        {view !== "promo" ? (
          <p className="representative-label">Representative data</p>
        ) : null}
        <ExtensionPreview view={view} />
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Store artwork preview root is missing.");
}

createRoot(root).render(<Preview />);
