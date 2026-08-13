import { defineConfig } from "wxt";
import { providerCatalog } from "./providers/catalog";

const providers = Object.values(providerCatalog);

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  hooks: {
    "entrypoints:found": (_wxt, entrypoints) => {
      const productionEntrypoints = entrypoints.filter(
        ({ inputPath }) => !inputPath.includes(".test."),
      );
      entrypoints.splice(0, entrypoints.length, ...productionEntrypoints);
    },
  },
  manifest: {
    name: "AI Limits",
    description:
      "Track ChatGPT, Claude, Kimi, Cursor, and ElevenLabs usage, resets, pace, and local history in one Chrome side panel.",
    minimum_chrome_version: "116",
    permissions: ["storage", "alarms", "sidePanel"],
    optional_host_permissions: providers.flatMap(
      ({ optionalOrigins }) => optionalOrigins,
    ),
    optional_permissions: [
      ...new Set(
        providers.flatMap(({ optionalPermissions }) => optionalPermissions),
      ),
    ],
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
