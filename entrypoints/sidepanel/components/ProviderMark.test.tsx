import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "vitest";

import { providerIds, type ProviderId } from "../../../providers/catalog";
import { ProviderMark } from "./ProviderMark";

describe("ProviderMark", () => {
  test("renders local decorative marks for supported and fallback identities", () => {
    const invalidProviderId = "unknown-provider" as ProviderId;
    const providers = [...providerIds, invalidProviderId];

    render(
      <div>
        {providers.map((providerId) => (
          <div key={providerId}>
            <span>{providerId}</span>
            <ProviderMark providerId={providerId} size="sm" />
          </div>
        ))}
      </div>,
    );

    const marks = Array.from(document.querySelectorAll("img"));
    expect(marks).toHaveLength(5);
    expect(marks.map((mark) => mark.getAttribute("src"))).toEqual([
      "/provider-marks/chatgpt.svg",
      "/provider-marks/claude.svg",
      "/provider-marks/kimi.svg",
      "/provider-marks/cursor.svg",
      "/provider-marks/fallback.svg",
    ]);
    expect(
      Array.from(document.querySelectorAll("source")).map((source) =>
        source.getAttribute("srcset"),
      ),
    ).toEqual([
      "/provider-marks/kimi-dark.svg",
      "/provider-marks/cursor-dark.svg",
    ]);
    expect(new Set(marks.slice(0, 4).map((mark) => mark.src))).toHaveProperty(
      "size",
      4,
    );
    expect(marks.every((mark) => mark.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
    expect(marks.every((mark) => mark.getAttribute("alt") === "")).toBe(true);
    expect(marks.every((mark) => mark.classList.contains("provider-mark"))).toBe(
      true,
    );
    expect(
      marks.slice(0, 4).map((mark) =>
        [...mark.classList].find((className) =>
          className.startsWith("provider-mark--provider-"),
        ),
      ),
    ).toEqual([
      "provider-mark--provider-chatgpt",
      "provider-mark--provider-claude",
      "provider-mark--provider-kimi",
      "provider-mark--provider-cursor",
    ]);
    expect(
      marks.some((mark) => mark.classList.contains("local-mark-tile")),
    ).toBe(false);
    expect(
      marks.some((mark) => mark.classList.contains("mark-contrast-tile")),
    ).toBe(false);
    expect(screen.getByText("unknown-provider")).toBeVisible();
  });
});
