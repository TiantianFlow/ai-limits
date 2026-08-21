import { describe, expect, it } from "vitest";

import {
  EXPECTED_DESCRIPTION,
  EXPECTED_OPTIONAL_ORIGINS,
  validateBuildManifest,
  validateSidePanelAssetText,
} from "./artifact-contract.mjs";

function validManifest() {
  return {
    manifest_version: 3,
    name: "__MSG_manifest_name__",
    description: "__MSG_manifest_description__",
    default_locale: "en",
    version: "0.3.5",
    minimum_chrome_version: "116",
    permissions: ["storage", "alarms", "sidePanel"],
    optional_permissions: ["cookies", "scripting"],
    optional_host_permissions: [...EXPECTED_OPTIONAL_ORIGINS],
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    action: { default_title: "__MSG_manifest_actionTitle__" },
    background: { service_worker: "background.js" },
    side_panel: { default_path: "sidepanel.html" },
  };
}

describe("built Chrome artifact contract", () => {
  it("accepts the static and dynamic optional provider origins and the store description", () => {
    expect(EXPECTED_DESCRIPTION.length).toBeLessThanOrEqual(132);
    expect(EXPECTED_OPTIONAL_ORIGINS).toHaveLength(9);
    expect(validateBuildManifest(validManifest(), "0.3.5")).toEqual([]);
  });

  it("rejects missing API access, broad ElevenLabs webpage access, and tabs", () => {
    const missingApi = validManifest();
    missingApi.optional_host_permissions = missingApi.optional_host_permissions.filter(
      (origin) => origin !== "https://api.elevenlabs.io/*",
    );
    expect(validateBuildManifest(missingApi, "0.3.5")).toContain(
      "Expected the exact static and dynamic optional provider origins.",
    );

    const broadPage = validManifest();
    broadPage.optional_host_permissions.push("https://elevenlabs.io/*");
    expect(validateBuildManifest(broadPage, "0.3.5")).toContain(
      "Expected the exact static and dynamic optional provider origins.",
    );

    const tabs = validManifest();
    tabs.permissions.push("tabs");
    expect(validateBuildManifest(tabs, "0.3.5")).toContain(
      "Expected permissions to be exactly alarms, sidePanel, storage.",
    );
  });

  it.each([
    "aiLimitsCredentials",
    "TRUSTED_CONTEXTS",
    "xi-api-key",
    "/v1/user/subscription",
    "aiLimitsPermissionIntents",
    "connectionRevision",
    "providerRegistry",
  ])(
    "rejects %s from a built side-panel asset while allowing ordinary key guidance",
    (forbidden) => {
      expect(validateSidePanelAssetText("Use your ElevenLabs API key.")).toEqual([]);
      expect(validateSidePanelAssetText(`prefix ${forbidden} suffix`)).toEqual([
        `Built side-panel assets contain forbidden background credential boundary: ${forbidden}.`,
      ]);
    },
  );
});
