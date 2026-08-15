import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

// OpenSourceFooter renders the extension version from the runtime manifest.
// @webext-core/fake-browser leaves browser.runtime.getManifest as a
// notMockedFunction that throws when called, so tests that render the footer
// (directly or via App/Cockpit) need a working manifest. Provide a minimal
// default for every test; the footer's `version ? … : null` guard then renders
// no version line. Individual tests override this via
// vi.spyOn(browser.runtime, "getManifest") when they need a specific version
// (e.g. OpenSourceFooter.test.tsx uses a sentinel to prove the wiring).
beforeEach(() => {
  vi.spyOn(browser.runtime, "getManifest").mockReturnValue({} as never);
});
