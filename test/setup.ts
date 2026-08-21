import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

import { chromeMessages, installI18nLocale } from "./i18n-harness";

// OpenSourceFooter renders the extension version from the runtime manifest.
// @webext-core/fake-browser leaves browser.runtime.getManifest as a
// notMockedFunction that throws when called, so tests that render the footer
// (directly or via App/Cockpit) need a working manifest. Provide a minimal
// default for every test; the footer's `version ? … : null` guard then renders
// no version line. Individual tests override this via
// vi.spyOn(browser.runtime, "getManifest") when they need a specific version
// (e.g. OpenSourceFooter.test.tsx uses a sentinel to prove the wiring).
//
// browser.i18n.getMessage is similarly empty under fake-browser. Install the
// English catalog so component tests assert translated copy by default.
beforeEach(async () => {
  const {
    LOCALE_OVERRIDE_STORAGE_KEY,
    preloadLocaleCatalog,
    resetLocaleRuntime,
  } = await import("../i18n/index");
  resetLocaleRuntime();
  preloadLocaleCatalog("en", chromeMessages("en"));
  preloadLocaleCatalog("zh_CN", chromeMessages("zh_CN"));
  installI18nLocale("en");
  await browser.storage.local.remove(LOCALE_OVERRIDE_STORAGE_KEY);
  vi.spyOn(browser.runtime, "getManifest").mockReturnValue({} as never);
});
