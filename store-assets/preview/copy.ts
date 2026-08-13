export type PreviewView =
  | "overview"
  | "pacing"
  | "history"
  | "privacy"
  | "promo"
  | "social";
export type PreviewLanguage = "en" | "zh_CN";

export const FIDELITY_FIXED_CLOCK = "2026-08-09T14:00:00.000Z";

export type FidelityScreen =
  | "first-run"
  | "overview"
  | "provider-detail"
  | "history"
  | "add-provider"
  | "settings"
  | "api-key-connect";
export type FidelityState =
  | "default"
  | "refresh-pending"
  | "partial-refresh"
  | "kimi-interaction"
  | "delete-confirmation";
export type FidelityMode = "used" | "left";
export type FidelityTheme = "light" | "dark";
export type FidelityPanelWidth = 340 | 400 | 460;

export interface FidelityRequest {
  screen: FidelityScreen;
  state: FidelityState;
  mode: FidelityMode;
  theme: FidelityTheme;
  panelWidth: FidelityPanelWidth;
  dataSource: "fixture";
  fixedClock: string;
  locale: "en-US";
  now: number;
}

export interface FidelityNavigationStep {
  actionSelector: string;
  readySelector: string;
}

export interface FidelityScenario {
  fixtureVariant: "empty" | "partial" | "full";
  readySelector: string;
  navigationSteps: FidelityNavigationStep[];
  isRefreshing: boolean;
  autoRefreshPending: boolean;
  refreshAnnouncement: string;
  providerOperation?: "waiting_for_session";
}

const FIDELITY_SCREENS = new Set<FidelityScreen>([
  "first-run",
  "overview",
  "provider-detail",
  "history",
  "add-provider",
  "settings",
  "api-key-connect",
]);
const FIDELITY_STATES = new Set<FidelityState>([
  "default",
  "refresh-pending",
  "partial-refresh",
  "kimi-interaction",
  "delete-confirmation",
]);
const FIDELITY_MODES = new Set<FidelityMode>(["used", "left"]);
const FIDELITY_THEMES = new Set<FidelityTheme>(["light", "dark"]);
const FIDELITY_WIDTHS = new Set<FidelityPanelWidth>([340, 400, 460]);

function requiredChoice<T extends string>(
  parameters: URLSearchParams,
  name: string,
  choices: ReadonlySet<T>,
): T {
  const value = parameters.get(name);
  if (!value || !choices.has(value as T)) {
    throw new Error(`Fidelity ${name} is missing or unsupported.`);
  }
  return value as T;
}

export function parseFidelityRequest(
  parameters: URLSearchParams,
): FidelityRequest | null {
  if (parameters.get("fidelity") !== "1") {
    return null;
  }

  if (parameters.get("dataSource") !== "fixture") {
    throw new Error("Fidelity renders require fixture data only.");
  }
  if (parameters.get("locale") !== "en-US") {
    throw new Error("Fidelity renders require the pinned en-US locale.");
  }

  const fixedClock = parameters.get("fixedClock");
  const now = fixedClock ? Date.parse(fixedClock) : Number.NaN;
  if (!fixedClock || !Number.isFinite(now)) {
    throw new Error("Fidelity renders require an explicit fixed clock.");
  }

  const panelWidth = Number(parameters.get("panelWidth"));
  if (!FIDELITY_WIDTHS.has(panelWidth as FidelityPanelWidth)) {
    throw new Error("Fidelity panelWidth is missing or unsupported.");
  }

  return {
    screen: requiredChoice(parameters, "screen", FIDELITY_SCREENS),
    state: requiredChoice(parameters, "state", FIDELITY_STATES),
    mode: requiredChoice(parameters, "mode", FIDELITY_MODES),
    theme: requiredChoice(parameters, "theme", FIDELITY_THEMES),
    panelWidth: panelWidth as FidelityPanelWidth,
    dataSource: "fixture",
    fixedClock,
    locale: "en-US",
    now,
  };
}

export function createFidelityScenario(
  request: FidelityRequest,
): FidelityScenario {
  const screenNavigation: Record<
    FidelityScreen,
    Pick<FidelityScenario, "fixtureVariant" | "readySelector" | "navigationSteps">
  > = {
    "first-run": {
      fixtureVariant: "empty",
      readySelector: '[aria-labelledby="first-run-title"]',
      navigationSteps: [],
    },
    overview: {
      fixtureVariant: "full",
      readySelector: ".app-header",
      navigationSteps: [],
    },
    "provider-detail": {
      fixtureVariant: "full",
      readySelector: '[aria-label="Kimi detail"]',
      navigationSteps: [
        {
          actionSelector: 'button[aria-label="Open Kimi details"]',
          readySelector: '[aria-label="Kimi detail"]',
        },
      ],
    },
    history: {
      fixtureVariant: "full",
      readySelector: '[aria-label="Kimi history"]',
      navigationSteps: [
        {
          actionSelector:
            'button[aria-label="Open Kimi history for 5-hour usage"]',
          readySelector: '[aria-label="Kimi history"]',
        },
      ],
    },
    "add-provider": {
      fixtureVariant: "partial",
      readySelector: '[aria-label="Add provider"]',
      navigationSteps: [
        {
          actionSelector: ".add-provider-action",
          readySelector: '[aria-label="Add provider"]',
        },
      ],
    },
    settings: {
      fixtureVariant: "full",
      readySelector: '[aria-label="Provider settings"]',
      navigationSteps: [
        {
          actionSelector: 'button[aria-label="Settings"]',
          readySelector: '[aria-label="Provider settings"]',
        },
      ],
    },
    "api-key-connect": {
      fixtureVariant: "full",
      readySelector: '[aria-label="Replace ElevenLabs API key"]',
      navigationSteps: [
        {
          actionSelector: 'button[aria-label="Settings"]',
          readySelector: '[aria-label="Provider settings"]',
        },
        {
          actionSelector: 'button[aria-label="Replace ElevenLabs API key"]',
          readySelector: '[aria-label="Replace ElevenLabs API key"]',
        },
      ],
    },
  };
  const navigation = screenNavigation[request.screen];
  const navigationSteps = [...navigation.navigationSteps];

  if (request.state === "delete-confirmation") {
    navigationSteps.push({
      actionSelector: ".danger-zone__trigger",
      readySelector: '[aria-label="Confirm local data deletion"]',
    });
  }

  return {
    ...navigation,
    navigationSteps,
    isRefreshing: request.state === "refresh-pending",
    autoRefreshPending: request.state === "refresh-pending",
    refreshAnnouncement:
      request.state === "partial-refresh"
        ? "3 providers updated. Kimi needs attention."
        : "",
    providerOperation:
      request.state === "kimi-interaction"
        ? "waiting_for_session"
        : undefined,
  };
}

interface ViewCopy {
  eyebrow: string;
  title: string;
  description: string;
}

interface PreviewContent extends Record<PreviewView, ViewCopy> {
  chromeSidePanelLabel: string;
  providerLine: string;
  pacingNotes: [string, string, string];
  privacyNotes: [string, string, string];
  productPreviewLabel: string;
  representativeLabel: string;
  socialNotes: [string, string];
}

export const previewContent: Record<PreviewLanguage, PreviewContent> = {
  en: {
    overview: {
      eyebrow: "One Chrome side panel",
      title: "Every AI limit, in one quiet view.",
      description:
        "See every provider as Used or Left, with reset timing, plan details, and local History—without hopping between account pages.",
    },
    pacing: {
      eyebrow: "Plan your usage",
      title: "Know the limit. See the pace.",
      description:
        "Compare quota consumption with elapsed time in its reset window, so bursts, reset windows, and remaining headroom are easy to scan.",
    },
    history: {
      eyebrow: "See the trend",
      title: "History that stays on your device.",
      description:
        "Successful refreshes build a local quota graph, with reset-aware gaps instead of misleading lines.",
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
      description: "Used or Left, reset timing, pace, and local history.",
    },
    social: {
      eyebrow: "Chrome side panel",
      title: "Usage limits, in one view.",
      description: "ChatGPT · Claude · Kimi · Cursor",
    },
    chromeSidePanelLabel: "Chrome side panel",
    providerLine: "ChatGPT · Claude · Kimi · Cursor · ElevenLabs · New API",
    pacingNotes: ["Used or Left", "Time elapsed", "Pace signal"],
    privacyNotes: [
      "Provider access is opt-in",
      "Normalized usage stays local",
      "No analytics or remote backend",
    ],
    productPreviewLabel: "AI Limits product preview",
    representativeLabel: "Representative data",
    socialNotes: [
      "Used or Left · Reset timing · Pace · Local history",
      "Local history. No remote backend.",
    ],
  },
  zh_CN: {
    overview: {
      eyebrow: "一个 Chrome 侧边栏",
      title: "AI 用量限制，一目了然。",
      description:
        "无需在各个账户页面之间切换，即可统一查看已用或剩余、重置时间、套餐详情和本地历史。",
    },
    pacing: {
      eyebrow: "规划你的用量",
      title: "看清上限，掌握节奏。",
      description:
        "将配额消耗与重置周期内已过的时间放在一起看，用量高峰、重置周期和剩余额度都能快速掌握。",
    },
    history: {
      eyebrow: "查看变化趋势",
      title: "用量历史，仅存本地。",
      description:
        "每次成功刷新都会更新本地配额图表；跨越重置周期或数据缺失时保留间隔，避免误导趋势。",
    },
    privacy: {
      eyebrow: "数据仅存本地",
      title: "私密数据，清晰掌控。",
      description:
        "按需连接各个服务，管理自动刷新，随时断开连接或删除所有本地数据。",
    },
    promo: {
      eyebrow: "Chrome 侧边栏",
      title: "AI 用量，一目了然。",
      description: "查看已用或剩余、重置时间、用量节奏和本地历史。",
    },
    social: {
      eyebrow: "Chrome 侧边栏",
      title: "AI 用量限制，一目了然。",
      description: "ChatGPT · Claude · Kimi · Cursor",
    },
    chromeSidePanelLabel: "Chrome 侧边栏",
    providerLine: "ChatGPT · Claude · Kimi · Cursor · ElevenLabs · New API",
    pacingNotes: ["已用或剩余", "已过时间", "用量节奏"],
    privacyNotes: [
      "服务访问需主动授权",
      "标准化用量数据仅存本地",
      "无分析追踪或远程后端",
    ],
    productPreviewLabel: "AI Limits 产品预览",
    representativeLabel: "示例数据 · 扩展界面暂为英文",
    socialNotes: [
      "已用或剩余 · 重置时间 · 用量节奏 · 本地历史",
      "历史仅存本地，无远程后端。",
    ],
  },
};

export function parsePreviewLanguage(
  parameters: URLSearchParams,
): PreviewLanguage {
  return parameters.get("locale") === "zh_CN" ? "zh_CN" : "en";
}
