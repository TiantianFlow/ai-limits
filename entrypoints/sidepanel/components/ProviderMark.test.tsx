import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "vitest";

import { providerKinds, type ProviderKind } from "../../../providers/catalog";
import { ProviderMark } from "./ProviderMark";

describe("ProviderMark", () => {
  test("renders local decorative marks for supported and fallback identities", () => {
    const invalidProviderId = "unknown-provider" as ProviderKind;
    const providers = [...providerKinds, invalidProviderId];

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
    expect(marks).toHaveLength(19);
    expect(marks.map((mark) => mark.getAttribute("src"))).toEqual([
      "/provider-marks/chatgpt.svg",
      "/provider-marks/claude.svg",
      "/provider-marks/kimi.svg",
      "/provider-marks/cursor.svg",
      "/provider-marks/grok.svg",
      "/provider-marks/elevenlabs.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
      "/provider-marks/fallback.svg",
    ]);
    expect(
      Array.from(document.querySelectorAll("source")).map((source) =>
        source.getAttribute("srcset"),
      ),
    ).toEqual([
      "/provider-marks/kimi-dark.svg",
      "/provider-marks/cursor-dark.svg",
      "/provider-marks/grok-dark.svg",
    ]);
    expect(new Set(marks.slice(0, 18).map((mark) => mark.src))).toHaveProperty(
      "size",
      7,
    );
    expect(marks.every((mark) => mark.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
    expect(marks.every((mark) => mark.getAttribute("alt") === "")).toBe(true);
    expect(marks.every((mark) => mark.classList.contains("provider-mark"))).toBe(
      true,
    );
    expect(
      marks.slice(0, 18).map((mark) =>
        [...mark.classList].find((className) =>
          className.startsWith("provider-mark--provider-"),
        ),
      ),
    ).toEqual([
      "provider-mark--provider-chatgpt",
      "provider-mark--provider-claude",
      "provider-mark--provider-kimi",
      "provider-mark--provider-cursor",
      "provider-mark--provider-grok",
      "provider-mark--provider-elevenlabs",
      "provider-mark--provider-newapi",
      "provider-mark--provider-litellm",
      "provider-mark--provider-clawrouter",
      "provider-mark--provider-sub2api",
      "provider-mark--provider-llmProxy",
      "provider-mark--provider-deepseek",
      "provider-mark--provider-moonshot",
      "provider-mark--provider-deepinfra",
      "provider-mark--provider-fireworks",
      "provider-mark--provider-openai",
      "provider-mark--provider-groqcloud",
      "provider-mark--provider-openrouter",
    ]);
    expect(
      marks.some((mark) => mark.classList.contains("local-mark-tile")),
    ).toBe(false);
    expect(
      marks.some((mark) => mark.classList.contains("mark-contrast-tile")),
    ).toBe(false);
    expect(marks[6]).toHaveClass("provider-mark--fallback");
    expect(
      marks.slice(0, 6).every((mark) =>
        !mark.classList.contains("provider-mark--fallback"),
      ),
    ).toBe(true);
    expect(screen.getByText("unknown-provider")).toBeVisible();
  });
});
