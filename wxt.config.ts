import { defineConfig } from "wxt";
import { providerDefinitions } from "./providers/definitions";

const providers = Object.values(providerDefinitions);

export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  hooks: {
    "entrypoints:found": (_wxt, entrypoints) => {
      const productionEntrypoints = entrypoints.filter(
        ({ inputPath }) => !inputPath.includes(".test."),
      );
      entrypoints.splice(0, entrypoints.length, ...productionEntrypoints);
    },
  },
  manifest: {
    name: "__MSG_manifest_name__",
    description: "__MSG_manifest_description__",
    default_locale: "en",
    minimum_chrome_version: "116",
    permissions: ["storage", "alarms", "sidePanel"],
    optional_host_permissions: [
      ...new Set(providers.flatMap(({ optionalOrigins }) => optionalOrigins)),
    ],
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
      default_title: "__MSG_manifest_actionTitle__",
      default_icon: {
        16: "icons/16.png",
        32: "icons/32.png",
        48: "icons/48.png",
        128: "icons/128.png",
      },
    },
  },
});
