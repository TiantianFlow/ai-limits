import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiKeyConnectView } from "./ApiKeyConnectView";

afterEach(cleanup);

function renderView(
  overrides: Partial<React.ComponentProps<typeof ApiKeyConnectView>> = {},
) {
  const props: React.ComponentProps<typeof ApiKeyConnectView> = {
    mode: "connect",
    backLabel: "Add provider",
    onBack: vi.fn(),
    onOpenSetup: vi.fn(),
    onSubmit: vi.fn(async () => "temporary_error" as const),
    ...overrides,
  };
  render(<ApiKeyConnectView {...props} />);
  return props;
}

describe("ApiKeyConnectView", () => {
  it("renders the compact three-step ElevenLabs guide and safe input", () => {
    renderView();

    expect(
      screen.getByRole("region", { name: "Connect ElevenLabs" }),
    ).toHaveClass("screen", "api-key-guide");
    expect(
      screen.getByRole("heading", { level: 1, name: "Connect ElevenLabs" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add provider" })).toBeVisible();
    expect(
      document.querySelector('img[src="/provider-marks/elevenlabs.svg"]'),
    ).not.toBeNull();
    expect(screen.getByText("Monthly credits · Voice limits")).toBeVisible();
    expect(document.querySelector(".settings-panel__heading")).toBeNull();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("Open the ElevenLabs API keys page");
    expect(steps[1]).toHaveTextContent("AI Limits");
    expect(steps[1]).toHaveTextContent("User → Read");
    expect(steps[1]).toHaveTextContent(/leave generation and write permissions off/i);
    expect(steps[2]).toHaveTextContent("Validate & connect");

    const input = screen.getByLabelText("ElevenLabs API key");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: /show|reveal/i })).toBeNull();
  });

  it("keeps the API keys page available repeatedly with standard action controls", () => {
    const onOpenSetup = vi.fn();
    renderView({ onOpenSetup });

    const open = screen.getByRole("button", { name: "Open API keys page" });
    fireEvent.click(open);
    fireEvent.click(open);

    expect(onOpenSetup).toHaveBeenCalledTimes(2);
    expect(open).toHaveClass("button", "button--secondary");
    expect(screen.getByRole("button", { name: "Add provider" })).toHaveClass(
      "page-header__back",
    );
    expect(
      screen.getByRole("button", { name: "Validate & connect" }),
    ).toHaveClass("button", "button--primary");
  });

  it("disables submission for trimmed blank and raw values over 4096 characters", () => {
    renderView();
    const input = screen.getByLabelText("ElevenLabs API key");
    const submit = screen.getByRole("button", { name: "Validate & connect" });

    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "a".repeat(4097) } });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: " a " } });
    expect(submit).toBeEnabled();
  });

  it.each([
    ["invalid_key", "Enter a valid ElevenLabs API key."],
    [
      "insufficient_scope",
      "Allow User → Read and check any IP restrictions, then try again.",
    ],
    [
      "temporary_error",
      "ElevenLabs could not be validated right now. Your existing data and key are unchanged.",
    ],
    [
      "permission_declined",
      "ElevenLabs access was not changed. Allow access when you are ready to try again.",
    ],
  ] as const)(
    "clears and never echoes the key after %s",
    async (result, expectedMessage) => {
      const secret = "not-a-real-elevenlabs-key";
      renderView({ onSubmit: vi.fn(async () => result) });
      const input = screen.getByLabelText("ElevenLabs API key");

      fireEvent.change(input, { target: { value: secret } });
      fireEvent.submit(within(screen.getByRole("form")).getByRole("button"));

      expect(await screen.findByText(expectedMessage)).toBeVisible();
      await waitFor(() => expect(input).toHaveValue(""));
      expect(document.body).not.toHaveTextContent(secret);
    },
  );

  it("uses replacement labels without changing the safety guidance", () => {
    renderView({ mode: "replace", backLabel: "Settings" });

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Replace ElevenLabs API key",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Validate & replace" }),
    ).toBeDisabled();
    expect(screen.getByText("User → Read")).toBeVisible();
  });
});
