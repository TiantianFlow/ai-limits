import React from "react";
import { createRoot } from "react-dom/client";

import { Cockpit } from "../../entrypoints/sidepanel/Cockpit";
import "../../entrypoints/sidepanel/styles.css";
import type { AppViewState } from "../../domain/public-protocol";
import type { AppState, DisplayMode } from "../../domain/model";
import type { ProviderInstanceId } from "../../domain/instances";
import { createFixtureState } from "../../providers/fixtures";
import { createInitialState } from "../../providers/initial-state";
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
import "./styles.css";

const DEFAULT_CAPTURE_NOW = Date.parse(FIDELITY_FIXED_CLOCK);

function fixtureViewState(state: AppState, now: number): AppViewState {
  const connectedInstances = state.providers.filter(
    (provider) =>
      provider.access === "granted" ||
      provider.snapshot !== undefined ||
      provider.history.length > 0 ||
      provider.lastAttempt !== undefined,
  );
  return {
    preferences: state.preferences,
    instances: connectedInstances.flatMap((provider) => {
      const instance = {
        id: `${provider.providerId}:default`,
        providerKind: provider.providerId,
        access: provider.access,
        createdAt: now - 2_000,
        history: provider.history,
        ...(provider.providerId === "newapi"
          ? {
              userLabel: "Personal relay",
              baseUrl: "https://relay.example/gateway",
              origin: "https://relay.example",
            }
          : {}),
        ...(provider.snapshot ? { snapshot: provider.snapshot } : {}),
        ...(provider.lastAttempt ? { lastAttempt: provider.lastAttempt } : {}),
      } satisfies AppViewState["instances"][number];
      if (provider.providerId !== "newapi") return [instance];
      return [
        instance,
        {
          ...structuredClone(instance),
          id: "newapi:22222222-2222-4222-8222-222222222222",
          userLabel: "Work relay for product engineering",
          createdAt: now - 1_000,
          snapshot: instance.snapshot
            ? {
                ...instance.snapshot,
                metrics: instance.snapshot.metrics.map((metric) =>
                  metric.type === "quota"
                    ? { ...metric, usedRatio: Math.min(1, metric.usedRatio + 0.18) }
                    : metric,
                ),
              }
            : undefined,
        },
      ];
    }),
  };
}

function createPreviewState(parameters: URLSearchParams, now: number): AppViewState {
  const fixture = createFixtureState(now);

  if (parameters.get("providers") === "none") {
    return fixtureViewState(createInitialState(), now);
  }

  if (parameters.get("providers") === "partial") {
    const initial = createInitialState();
    initial.providers[0] = fixture.providers[0]!;
    return fixtureViewState(initial, now);
  }

  return fixtureViewState(fixture, now);
}

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
  const state = createPreviewState(parameters, now);
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

function createFidelityState(
  request: FidelityRequest,
  scenario: FidelityScenario,
): AppViewState {
  const fixture = createFixtureState(request.now);
  let state: AppState;

  if (scenario.fixtureVariant === "empty") {
    state = createInitialState();
  } else if (scenario.fixtureVariant === "partial") {
    state = createInitialState();
    state.providers[0] = fixture.providers[0]!;
  } else {
    state = fixture;
  }

  state.preferences = {
    ...state.preferences,
    displayMode: request.mode,
  };

  if (
    request.state === "partial-refresh" ||
    request.state === "kimi-interaction"
  ) {
    const kimi = state.providers.find(
      (provider) => provider.providerId === "kimi",
    );
    if (kimi) {
      kimi.lastAttempt = {
        trigger: "scheduled",
        startedAt: request.now - 15_000,
        finishedAt: request.now - 10_000,
        outcome: { kind: "deferred", reason: "session_required" },
      };
    }
  }

  return fixtureViewState(state, request.now);
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
    createFidelityState(request, scenario),
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
    setState((current) => ({
      ...current,
      preferences: { ...current.preferences, displayMode: mode },
    }));
  };
  const updateAutoRefresh = (autoRefresh: boolean) => {
    setState((current) => ({
      ...current,
      preferences: { ...current.preferences, autoRefresh },
    }));
  };
  const disconnectInstance = (instanceId: ProviderInstanceId) => {
    setState((current) => ({
      ...current,
      instances: current.instances.map((instance) =>
        instance.id === instanceId
          ? { ...instance, access: "required", snapshot: undefined, history: [] }
          : instance,
      ),
    }));
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
