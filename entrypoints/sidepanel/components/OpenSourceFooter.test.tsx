import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenSourceFooter } from "./OpenSourceFooter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OpenSourceFooter", () => {
  it("shows the extension version read from the runtime manifest", () => {
    // Sentinel value proves the version is wired from the manifest, not hardcoded.
    vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
      version: "9.9.9",
    } as never);

    render(<OpenSourceFooter />);

    expect(screen.getByText("Version 9.9.9")).toBeVisible();
  });

  it("renders no version line when the manifest exposes no version", () => {
    vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
      version: undefined,
    } as never);

    render(<OpenSourceFooter />);

    expect(screen.queryByText(/^Version /)).not.toBeInTheDocument();
  });
});
