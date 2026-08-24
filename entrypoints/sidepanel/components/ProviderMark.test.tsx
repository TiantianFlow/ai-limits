import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "vitest";

import {
  providerKinds,
  providerPresentation,
  type ProviderKind,
} from "../../../providers/catalog";
import { ProviderMark } from "./ProviderMark";

const fallbackMarkPath = "/provider-marks/fallback.svg";

describe("ProviderMark", () => {
  test("renders a distinct local mark for every catalog provider", () => {
    const invalidProviderId = "unknown-provider" as ProviderKind;
    const catalogMarkPaths = providerKinds.map(
      (providerKind) => providerPresentation(providerKind).markPath,
    );
    const catalogDarkMarkPaths = providerKinds.flatMap((providerKind) => {
      const darkMarkPath = providerPresentation(providerKind).darkMarkPath;
      return darkMarkPath ? [darkMarkPath] : [];
    });

    expect(
      catalogMarkPaths.every((markPath) => markPath !== fallbackMarkPath),
    ).toBe(true);
    expect(new Set(catalogMarkPaths).size).toBe(providerKinds.length);

    render(
      <div>
        {[...providerKinds, invalidProviderId].map((providerId) => (
          <div key={providerId}>
            <span>{providerId}</span>
            <ProviderMark providerId={providerId} size="sm" />
          </div>
        ))}
      </div>,
    );

    const marks = Array.from(document.querySelectorAll("img"));
    expect(marks).toHaveLength(providerKinds.length + 1);
    expect(marks.map((mark) => mark.getAttribute("src"))).toEqual([
      ...catalogMarkPaths,
      fallbackMarkPath,
    ]);
    expect(
      Array.from(document.querySelectorAll("source")).map((source) =>
        source.getAttribute("srcset"),
      ),
    ).toEqual(catalogDarkMarkPaths);
    expect(marks.every((mark) => mark.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
    expect(marks.every((mark) => mark.getAttribute("alt") === "")).toBe(true);
    expect(marks.every((mark) => mark.classList.contains("provider-mark"))).toBe(
      true,
    );
    expect(
      marks.slice(0, providerKinds.length).map((mark) =>
        [...mark.classList].find((className) =>
          className.startsWith("provider-mark--provider-"),
        ),
      ),
    ).toEqual(
      providerKinds.map((providerKind) => `provider-mark--provider-${providerKind}`),
    );
    expect(
      marks.some((mark) => mark.classList.contains("local-mark-tile")),
    ).toBe(false);
    expect(
      marks.some((mark) => mark.classList.contains("mark-contrast-tile")),
    ).toBe(false);
    expect(
      marks
        .slice(0, providerKinds.length)
        .every((mark) => !mark.classList.contains("provider-mark--fallback")),
    ).toBe(true);
    expect(marks.at(-1)).toHaveClass("provider-mark--fallback");
    expect(screen.getByText("unknown-provider")).toBeVisible();
  });
});
