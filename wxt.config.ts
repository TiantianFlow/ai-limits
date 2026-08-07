import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "AI Limits",
    version: "0.1.0",
    description: "One quiet cockpit for AI subscription limits.",
    minimum_chrome_version: "116",
    permissions: ["storage", "alarms", "sidePanel"],
    optional_host_permissions: ["https://chatgpt.com/*"],
    action: { default_title: "Open AI Limits" },
  },
});
