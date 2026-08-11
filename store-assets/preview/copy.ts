export type PreviewView = "overview" | "pacing" | "privacy" | "promo";
export type PreviewLanguage = "en" | "zh_CN";

interface ViewCopy {
  eyebrow: string;
  title: string;
  description: string;
}

interface PreviewContent extends Record<PreviewView, ViewCopy> {
  chromeSidePanelLabel: string;
  pacingNotes: [string, string, string];
  privacyNotes: [string, string, string];
  productPreviewLabel: string;
  representativeLabel: string;
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
    privacy: {
      eyebrow: "Local by design",
      title: "Clear controls for private account data.",
      description:
        "Connect providers individually, control automatic refresh, disconnect at any time, or delete all local data.",
    },
    promo: {
      eyebrow: "Chrome side panel",
      title: "AI limits, at a glance.",
      description: "Used or Left, reset timing, pace, and local history for your AI subscriptions.",
    },
    chromeSidePanelLabel: "Chrome side panel",
    pacingNotes: ["Used or Left", "Time elapsed", "Pace signal"],
    privacyNotes: [
      "Provider access is opt-in",
      "Normalized usage stays local",
      "No analytics or remote backend",
    ],
    productPreviewLabel: "AI Limits product preview",
    representativeLabel: "Representative data",
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
    privacy: {
      eyebrow: "数据仅存本地",
      title: "私密数据，清晰掌控。",
      description:
        "按需连接各个服务，管理自动刷新，随时断开连接或删除所有本地数据。",
    },
    promo: {
      eyebrow: "Chrome 侧边栏",
      title: "AI 用量，一目了然。",
      description: "集中查看已用或剩余、重置时间、用量节奏和本地历史。",
    },
    chromeSidePanelLabel: "Chrome 侧边栏",
    pacingNotes: ["已用或剩余", "已过时间", "用量节奏"],
    privacyNotes: [
      "服务访问需主动授权",
      "标准化用量数据仅存本地",
      "无分析追踪或远程后端",
    ],
    productPreviewLabel: "AI Limits 产品预览",
    representativeLabel: "示例数据 · 扩展界面暂为英文",
  },
};

export function parsePreviewLanguage(
  parameters: URLSearchParams,
): PreviewLanguage {
  return parameters.get("locale") === "zh_CN" ? "zh_CN" : "en";
}
