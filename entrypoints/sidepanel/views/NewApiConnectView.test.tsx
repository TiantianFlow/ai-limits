import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewApiConnectView } from "./NewApiConnectView";

afterEach(cleanup);

function renderView(
  overrides: Partial<React.ComponentProps<typeof NewApiConnectView>> = {},
) {
  const props: React.ComponentProps<typeof NewApiConnectView> = {
    mode: "connect",
    backLabel: "Add provider",
    onBack: vi.fn(),
    onSubmit: vi.fn(async () => "temporary_error" as const),
    ...overrides,
  };
  render(<NewApiConnectView {...props} />);
  return props;
}

describe("NewApiConnectView", () => {
  it("documents the supported one-instance relay-key mode and its limits", () => {
    renderView();

    expect(screen.getByRole("heading", { level: 1, name: "Connect New API" })).toBeVisible();
    expect(screen.getByText(/one New API instance and one relay key/i)).toBeVisible();
    expect(screen.getByText(/key-specific granted, used, and remaining quota/i)).toBeVisible();
    expect(screen.getByText(/unlimited keys show absolute usage/i)).toBeVisible();
    expect(screen.getByText(/does not read account wallet, subscriptions, admin data, or multiple instances/i)).toBeVisible();
    expect(screen.getByText(/request is read-only, but the relay key itself may still call models/i)).toBeVisible();
  });

  it("explains and applies tolerant site URL normalization", async () => {
    const onSubmit = vi.fn(async () => "invalid_key" as const);
    renderView({ onSubmit });

    expect(screen.getByText(/homepage, dashboard URL, or an API URL such as/i)).toHaveTextContent(
      "/v1/messages",
    );
    expect(screen.getByText(/removes known console and API suffixes/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://API.example.com/new-api/v1/messages" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: " sk-test " },
    });
    fireEvent.submit(within(screen.getByRole("form")).getByRole("button"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "https://api.example.com/new-api",
        " sk-test ",
      ),
    );
    expect(screen.getByLabelText("New API site URL")).toHaveValue(
      "https://api.example.com/new-api",
    );
    expect(screen.getByLabelText("New API relay key")).toHaveValue("");
  });

  it("rejects ambiguous and unsafe URLs before requesting access", () => {
    const onSubmit = vi.fn();
    renderView({ onSubmit });
    const site = screen.getByLabelText("New API site URL");
    const key = screen.getByLabelText("New API relay key");
    const submit = screen.getByRole("button", { name: "Validate & connect" });

    fireEvent.change(site, { target: { value: "api.example.com/v1" } });
    fireEvent.change(key, { target: { value: "sk-test" } });
    expect(submit).toBeDisabled();
    fireEvent.change(site, { target: { value: "http://public.example.com/v1" } });
    expect(submit).toBeDisabled();
    fireEvent.change(site, { target: { value: "http://localhost:3000/v1" } });
    expect(submit).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_site", "This site did not return compatible New API status and usage data."],
    ["invalid_key", "Enter a valid relay key for this New API instance."],
    ["insufficient_scope", "This relay key could not read its usage."],
    ["temporary_error", "New API could not be validated right now."],
    ["permission_declined", "New API access was not changed."],
  ] as const)("shows actionable %s feedback without echoing the key", async (result, copy) => {
    renderView({ onSubmit: vi.fn(async () => result) });
    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://api.example.com" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "secret-relay-key" },
    });
    fireEvent.submit(within(screen.getByRole("form")).getByRole("button"));

    expect(await screen.findByText(copy, { exact: false })).toBeVisible();
    expect(document.body).not.toHaveTextContent("secret-relay-key");
  });
});
