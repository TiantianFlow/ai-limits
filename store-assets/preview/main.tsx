import React from "react";
import { createRoot } from "react-dom/client";

import { Cockpit } from "../../entrypoints/sidepanel/Cockpit";
import "../../entrypoints/sidepanel/styles.css";
import type { AppViewState } from "../../domain/public-protocol";
import type { DisplayMode } from "../../domain/model";
import type { ProviderInstanceId } from "../../domain/instances";
import {
  FIDELITY_FIXED_CLOCK,
  createFidelityScenario,
  parseFidelityRequest,
  parsePreviewLanguage,
  previewContent,
  type FidelityRequest,
  type FidelityScenario,
  type PreviewView,
} from "./copy";
import {
  createFidelityPreviewState,
  createStorePreviewState,
  updatePreviewState,
} from "./preview-state";
import "./styles.css";

const DEFAULT_CAPTURE_NOW = Date.parse(FIDELITY_FIXED_CLOCK);

function parseMarketingClock(parameters: URLSearchParams): {
  fixedClock: string;
  now: number;
} {
  const fixedClock = parameters.get("fixedClock") ?? FIDELITY_FIXED_CLOCK;
  const now = Date.parse(fixedClock);
  if (!Number.isFinite(now)) {
    throw new Error("Store artwork preview received an invalid fixed clock.");
  }
  return { fixedClock, now };
}

function parseView(parameters: URLSearchParams): PreviewView {
  const candidate = parameters.get("view");
  return candidate === "pacing" ||
    candidate === "history" ||
    candidate === "privacy" ||
    candidate === "promo" ||
    candidate === "social"
    ? candidate
    : "overview";
}

function parsePanelWidth(parameters: URLSearchParams): 340 | 400 | 460 | undefined {
  const candidate = Number(parameters.get("panelWidth"));
  return candidate === 340 || candidate === 400 || candidate === 460
    ? candidate
    : undefined;
}

function FeatureNotes({
  view,
  providerLine,
  pacingNotes,
  privacyNotes,
  socialNotes,
}: {
  view: PreviewView;
  providerLine: string;
  pacingNotes: [string, string, string];
  privacyNotes: [string, string, string];
  socialNotes: [string, string];
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
    return <p className="provider-line">{providerLine}</p>;
  }

  if (view === "social") {
    return (
      <div className="social-notes">
        <p>{socialNotes[0]}</p>
        <p>{socialNotes[1]}</p>
      </div>
    );
  }

  return null;
}

function ExtensionPreview({
  chromeSidePanelLabel,
  now,
  panelWidth,
  state,
}: {
  chromeSidePanelLabel: string;
  now: number;
  panelWidth?: 340 | 400 | 460;
  state: AppViewState;
}) {
  return (
    <div
      className="extension-frame"
      style={panelWidth ? { width: `${panelWidth}px` } : undefined}
    >
      <div className="extension-frame__bar" aria-hidden="true">
        <span className="extension-frame__dot" />
        <span>AI Limits</span>
        <span className="extension-frame__chrome">{chromeSidePanelLabel}</span>
      </div>
      <div
        className="panel-frame"
        data-panel-frame
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        <Cockpit
          state={state}
          now={now}
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
  const { fixedClock, now } = parseMarketingClock(parameters);
  const view = parseView(parameters);
  const language = parsePreviewLanguage(parameters);
  const panelWidth = parsePanelWidth(parameters);
  const state = createStorePreviewState(parameters, now);
  const content = previewContent[language];
  const copy = content[view];

  return (
    <main
      className={`capture-page capture-page--${view}`}
      data-preview-ready
      data-data-source="fixture"
      data-fixed-clock={fixedClock}
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
          providerLine={content.providerLine}
          pacingNotes={content.pacingNotes}
          privacyNotes={content.privacyNotes}
          socialNotes={content.socialNotes}
        />
      </section>

      <section
        className="product-stage"
        aria-label={content.productPreviewLabel}
      >
        {view !== "promo" ? (
          <p className="representative-label">{content.representativeLabel}</p>
        ) : null}
        <ExtensionPreview
          chromeSidePanelLabel={content.chromeSidePanelLabel}
          now={now}
          panelWidth={panelWidth}
          state={state}
        />
      </section>
    </main>
  );
}

function waitForElement(
  selector: string,
  signal: AbortSignal,
): Promise<HTMLElement> {
  const current = document.querySelector<HTMLElement>(selector);
  if (current) {
    return Promise.resolve(current);
  }

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const match = document.querySelector<HTMLElement>(selector);
      if (match) {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(match);
      }
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Fidelity preview could not find ${selector}.`));
    }, 5_000);

    signal.addEventListener(
      "abort",
      () => {
        observer.disconnect();
        window.clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function FidelityPreview({ request }: { request: FidelityRequest }) {
  const scenario = React.useMemo(
    () => createFidelityScenario(request),
    [request],
  );
  const [state, setState] = React.useState(() =>
    createFidelityPreviewState(request, scenario),
  );
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.dataset.fidelityTheme = request.theme;
    document.documentElement.style.colorScheme = request.theme;
    const controller = new AbortController();

    void (async () => {
      await waitForElement(scenario.readySelector, controller.signal);
      await nextPaint();
      if (!controller.signal.aborted) {
        setReady(true);
      }
    })();

    return () => controller.abort();
  }, [request.theme, scenario]);

  const updateMode = (mode: DisplayMode) => {
    setState((current) => updatePreviewState(current, (candidate) => ({
      ...candidate,
      preferences: { ...candidate.preferences, displayMode: mode },
    })));
  };
  const updateAutoRefresh = (autoRefresh: boolean) => {
    setState((current) =>
      updatePreviewState(current, (candidate) => ({
        ...candidate,
        preferences: { ...candidate.preferences, autoRefresh },
      })),
    );
  };
  const disconnectInstance = (instanceId: ProviderInstanceId) => {
    setState((current) =>
      updatePreviewState(current, (candidate) => ({
        ...candidate,
        instances: candidate.instances.map((instance) => {
          if (instance.id !== instanceId) return instance;
          const { snapshot: _snapshot, ...disconnected } = instance;
          return { ...disconnected, access: "required" as const, history: [] };
        }),
      })),
    );
  };

  return (
    <div
      className="fidelity-page"
      data-data-source={request.dataSource}
      data-fidelity-preview
      data-fidelity-ready={ready ? "true" : "false"}
      data-fixed-clock={request.fixedClock}
      data-mode={request.mode}
      data-locale={request.locale}
      data-panel-width={request.panelWidth}
      data-screen={request.screen}
      data-state={request.state}
      data-theme={request.theme}
      style={{ width: `${request.panelWidth}px` }}
    >
      <Cockpit
        state={state}
        now={request.now}
        isRefreshing={scenario.isRefreshing}
        refreshAnnouncement={scenario.refreshAnnouncement}
        refreshAnnouncementId={scenario.refreshAnnouncement ? 1 : 0}
        autoRefreshPending={scenario.autoRefreshPending}
        providerOperations={
          scenario.providerOperation
            ? { "kimi:default": scenario.providerOperation }
            : undefined
        }
        onDisplayModeChange={updateMode}
        onRefresh={() => undefined}
        onConnectProvider={() => undefined}
        onRefreshInstance={() => undefined}
        onAutoRefreshChange={updateAutoRefresh}
        onDisconnectInstance={disconnectInstance}
        onRenameInstance={async (instanceId, userLabel) => {
          setState((current) =>
            updatePreviewState(current, (candidate) => ({
              ...candidate,
              instances: candidate.instances.map((instance) => {
                if (instance.id !== instanceId || request.state === "rename-failure") {
                  return instance;
                }
                if (userLabel === undefined) {
                  const { userLabel: _userLabel, ...unlabeled } = instance;
                  return unlabeled;
                }
                return { ...instance, userLabel };
              }),
            })),
          );
          return request.state !== "rename-failure";
        }}
        onDeleteLocalData={() => undefined}
      />
    </div>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Store artwork preview root is missing.");
}

const fidelityRequest = parseFidelityRequest(
  new URLSearchParams(window.location.search),
);

createRoot(root).render(
  fidelityRequest ? <FidelityPreview request={fidelityRequest} /> : <Preview />,
);
