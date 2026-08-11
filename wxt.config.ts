import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "AI Limits",
    description:
      "See ChatGPT, Claude, Kimi, and Cursor usage as Used or Left, reset timing, pace, and local quota history in one Chrome side panel.",
    minimum_chrome_version: "116",
    permissions: ["storage", "alarms", "sidePanel"],
    optional_host_permissions: [
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://www.kimi.com/*",
      "https://cursor.com/*",
    ],
    optional_permissions: ["cookies", "scripting"],
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    action: {
      default_title: "Open AI Limits",
      default_icon: {
        16: "icons/16.png",
        32: "icons/32.png",
        48: "icons/48.png",
        128: "icons/128.png",
      },
    },
  },
});
