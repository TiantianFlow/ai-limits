import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  AppState,
  ProviderRefreshOutcome,
  RefreshReport,
} from "../../domain/model";
import type { AppViewState } from "../../background/view-state";
import { createFixtureState } from "../../providers/fixtures";
import { createInitialState } from "../../providers/initial-state";
import { providerRegistry } from "../../providers/registry";
import { saveState } from "../../storage/repository";
import { App } from "./App";

const NOW = Date.UTC(2026, 7, 7, 16);
const TEST_PERMISSION_INTENT = "550e8400-e29b-41d4-a716-446655440099";
const TEST_NEW_API_INSTANCE =
  "newapi:33333333-3333-4333-8333-333333333333";

let messageListener:
  | ((
      message: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean)
  | undefined;

afterEach(() => {
  cleanup();
  if (messageListener) {
    browser.runtime.onMessage.removeListener(messageListener);
    messageListener = undefined;
  }
  vi.restoreAllMocks();
});

function installMessageHandler(
  handler: (message: Record<string, unknown>, respond: (value: unknown) => void) => void,
) {
  messageListener = (message, _sender, sendResponse) => {
    handler(message as Record<string, unknown>, (value) =>
      sendResponse(toPublicControlResponse(message as Record<string, unknown>, value)),
    );
    return true;
  };
  browser.runtime.onMessage.addListener(messageListener);
}

function toPublicControlResponse(
  message: Record<string, unknown>,
  value: unknown,
): unknown {
  const publicValue = toPublicResponse(value);
  if (
    message.type !== "PREPARE_PROVIDER_PERMISSION" ||
    !message.providerKind ||
    typeof message.providerKind !== "string" ||
    !(message.providerKind in providerRegistry) ||
    !publicValue ||
    typeof publicValue !== "object" ||
    !("preferences" in publicValue)
  ) {
    return publicValue;
  }
  const providerKind = message.providerKind as keyof typeof providerRegistry;
  const config = providerRegistry[providerKind].normalizeConfig(message.config);
  return {
    state: publicValue,
    permissionIntentId: TEST_PERMISSION_INTENT,
    instanceId:
      typeof message.instanceId === "string"
        ? message.instanceId
        : providerKind === "newapi"
          ? TEST_NEW_API_INSTANCE
          : `${providerKind}:default`,
    permissions: config
      ? providerRegistry[providerKind].requiredPermissions(config) ?? {}
      : {},
  };
}

function report(
  providers: Partial<Record<AppState["providers"][number]["providerId"], ProviderRefreshOutcome>>,
  trigger: RefreshReport["trigger"] = "manual_all",
): RefreshReport {
  return {
    trigger,
    startedAt: NOW,
    finishedAt: NOW + 1_000,
    results: Object.entries(providers).map(([providerKind, outcome]) => ({
      instanceId: `${providerKind}:default`,
      outcome: outcome!,
    })),
  };
}

function successfulOutcomes(
  state: AppState,
): Partial<Record<AppState["providers"][number]["providerId"], ProviderRefreshOutcome>> {
  return Object.fromEntries(
    state.providers.map((provider) => [
      provider.providerId,
      {
        kind: "success",
        snapshot: provider.snapshot!,
      } satisfies ProviderRefreshOutcome,
    ]),
  );
}

function toPublicState(state: AppState): AppViewState {
  return {
    preferences: state.preferences,
    instances: state.providers.filter(
      (provider) =>
        provider.access === "granted" ||
        provider.snapshot !== undefined ||
        provider.history.length > 0 ||
        provider.lastAttempt !== undefined,
    ).map((provider) => ({
      id: `${provider.providerId}:default`,
      providerKind: provider.providerId,
      access: provider.access,
      createdAt: NOW,
      history: provider.history,
      ...(provider.snapshot
        ? {
            snapshot: (() => {
              const { accountLabel: _accountLabel, ...rest } = provider.snapshot;
              return rest;
            })(),
          }
        : {}),
      ...(provider.lastAttempt ? { lastAttempt: provider.lastAttempt } : {}),
    })),
  };
}

function toPublicResponse(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if ("version" in value && value.version === 4) {
    return toPublicState(value as AppState);
  }
  if ("state" in value && value.state && typeof value.state === "object") {
    return {
      ...value,
      state:
        "version" in value.state && value.state.version === 4
          ? toPublicState(value.state as AppState)
          : value.state,
    };
  }
  return value;
}

describe("side-panel App", () => {
  test("keeps New API add mode instance-free after an existing instance", async () => {
    const initial = createInitialState();
    initial.providers[5] = {
      providerId: "newapi",
      access: "granted",
      history: [],
      snapshot: {
        providerKind: "newapi",
        accountLabel: "Personal relay",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [],
      },
    };
    const commands: Record<string, unknown>[] = [];
    vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "CONNECT_API_KEY_PROVIDER"
          ? {
              state: initial,
              report: report({}, "connect"),
              result: "invalid_key",
            }
          : initial,
      );
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect New API" }));
    fireEvent.change(screen.getByLabelText("Instance label (optional)"), {
      target: { value: "Work relay" },
    });
    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://relay.example" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "candidate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    await waitFor(() =>
      expect(commands).toContainEqual({
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind: "newapi",
        userLabel: "Work relay",
        config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      }),
    );
    expect(
      commands.find(({ type }) => type === "PREPARE_PROVIDER_PERMISSION"),
    ).not.toHaveProperty("instanceId");
    await waitFor(() =>
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "CONNECT_API_KEY_PROVIDER",
          instanceId: TEST_NEW_API_INSTANCE,
        }),
      ),
    );
  });

  test("requests only the normalized New API instance and sends one candidate command", async () => {
    const initial = createInitialState();
    const commands: Record<string, unknown>[] = [];
    const requestPermission = vi
      .spyOn(browser.permissions, "request")
      .mockResolvedValue(true as never);
    const createTab = vi.spyOn(browser.tabs, "create");
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "CONNECT_API_KEY_PROVIDER"
          ? {
              state: initial,
              report: report({
                newapi: { kind: "failure", category: "credential_invalid" },
              }, "connect"),
              result: "invalid_key",
            }
          : initial,
      );
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect New API" }),
    );
    expect(createTab).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://API.example.com/gateway/v1/messages" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "sk-candidate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    await waitFor(() =>
      expect(commands).toContainEqual({
        type: "CONNECT_API_KEY_PROVIDER",
        providerKind: "newapi",
        instanceId: TEST_NEW_API_INSTANCE,
        config: {
          kind: "dynamic-origin",
          baseUrl: "https://api.example.com/gateway",
        },
        apiKey: "sk-candidate",
        permissionIntentId: TEST_PERMISSION_INTENT,
      }),
    );
    expect(requestPermission).toHaveBeenCalledWith({
      origins: ["https://api.example.com/*"],
    });
    expect(requestPermission).not.toHaveBeenCalledWith({
      origins: ["https://*/*"],
    });
  });

  test("replaces only the selected New API instance and clears a blank custom label", async () => {
    const personalId = "newapi:11111111-1111-4111-8111-111111111111";
    const workId = "newapi:22222222-2222-4222-8222-222222222222";
    const state: AppViewState = {
      preferences: { displayMode: "used", autoRefresh: true },
      instances: [
        {
          id: personalId,
          providerKind: "newapi",
          userLabel: "Personal relay",
          baseUrl: "https://relay.example",
          origin: "https://relay.example",
          access: "granted",
          createdAt: NOW - 2_000,
          history: [],
          snapshot: {
            providerKind: "newapi",
            source: "api-key",
            fetchedAt: NOW,
            metrics: [],
          },
        },
        {
          id: workId,
          providerKind: "newapi",
          userLabel: "Work relay",
          baseUrl: "https://relay.example/gateway",
          origin: "https://relay.example",
          access: "granted",
          createdAt: NOW - 1_000,
          history: [
            {
              observedAt: NOW - 500,
              metrics: [
                {
                  type: "quota",
                  metricId: "relay-key-quota",
                  usedRatio: 0.4,
                },
              ],
            },
          ],
          snapshot: {
            providerKind: "newapi",
            accountLabel: "Relay account",
            source: "api-key",
            fetchedAt: NOW,
            metrics: [
              {
                type: "quota",
                id: "relay-key-quota",
                label: "API key quota",
                scope: "feature",
                usedRatio: 0.4,
              },
            ],
          },
        },
      ],
    };
    const renamed = structuredClone(state);
    delete renamed.instances[1]!.userLabel;
    const commands: Record<string, unknown>[] = [];
    const requestPermission = vi
      .spyOn(browser.permissions, "request")
      .mockResolvedValue(true as never);
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "RENAME_INSTANCE"
          ? renamed
          : message.type === "CONNECT_API_KEY_PROVIDER"
            ? {
                state: renamed,
                report: {
                  trigger: "connect",
                  startedAt: NOW,
                  finishedAt: NOW + 1,
                  results: [
                    {
                      instanceId: workId,
                      outcome: {
                        kind: "success",
                        snapshot: renamed.instances[1]!.snapshot!,
                      },
                    },
                  ],
                },
                result: "connected",
              }
            : state,
      );
    });

    render(<App />);
    await screen.findByText("Personal relay");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Work relay" }));
    fireEvent.change(screen.getByLabelText("Instance label"), {
      target: { value: "   " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save label for Work relay" }),
    );

    await waitFor(() =>
      expect(commands).toContainEqual({
        type: "RENAME_INSTANCE",
        instanceId: workId,
      }),
    );
    expect(await screen.findByText("Relay account")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Replace Relay account API key" }),
    );
    expect(screen.getByLabelText("New API site URL")).toHaveValue(
      "https://relay.example/gateway",
    );
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & replace" }));

    await waitFor(() =>
      expect(commands).toContainEqual({
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind: "newapi",
        instanceId: workId,
        userLabel: "",
        config: {
          kind: "dynamic-origin",
          baseUrl: "https://relay.example/gateway",
        },
      }),
    );
    expect(requestPermission).toHaveBeenCalledWith({
      origins: ["https://relay.example/*"],
    });
    expect(
      commands.find(
        ({ type, instanceId }) =>
          type === "PREPARE_PROVIDER_PERMISSION" && instanceId === workId,
      ),
    ).not.toHaveProperty("instanceId", personalId);
    await waitFor(() =>
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "CONNECT_API_KEY_PROVIDER",
          providerKind: "newapi",
          instanceId: workId,
          userLabel: "",
          config: {
            kind: "dynamic-origin",
            baseUrl: "https://relay.example/gateway",
          },
          apiKey: "replacement",
        }),
      ),
    );
  });

  test("rejects secret-bearing nested fields in public view state", async () => {
    const state = toPublicState(createFixtureState(NOW));
    const metric = state.instances[0]!.snapshot!.metrics[0]!;
    const unsafeMetric: Record<string, unknown> = {
      ...metric,
      credential: "must-not-cross-the-boundary",
    };
    state.instances[0]!.snapshot!.metrics[0] = unsafeMetric as unknown as typeof metric;
    vi.spyOn(browser.runtime, "sendMessage").mockResolvedValue(state as never);

    render(<App />);

    expect(await screen.findByText("Couldn’t load usage.")).toBeVisible();
    expect(document.body).not.toHaveTextContent("must-not-cross-the-boundary");
  });

  test("rejects non-exact instance-keyed refresh reports", async () => {
    const state = toPublicState(createFixtureState(NOW));
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) =>
        (message as { type?: string }).type === "REFRESH_INSTANCE"
          ? {
              state,
              report: {
                trigger: "manual_provider",
                startedAt: NOW,
                finishedAt: NOW + 1,
                results: [
                  {
                    instanceId: "chatgpt:default",
                    outcome: { kind: "success", snapshot: state.instances[0]!.snapshot },
                  },
                ],
                apiKey: "must-not-cross-the-boundary",
              },
            }
          : state as never,
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh ChatGPT" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the ChatGPT refresh result. Check the latest usage before retrying.",
    );
    expect(document.body).not.toHaveTextContent("must-not-cross-the-boundary");
  });

  test("opens the ElevenLabs setup page without requesting API access", async () => {
    const state = createInitialState();
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValue(toPublicState(state) as never);
    const requestPermission = vi.spyOn(browser.permissions, "request");
    const createTab = vi
      .spyOn(browser.tabs, "create")
      .mockResolvedValue({ id: 7 } as never);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ElevenLabs" }),
    );

    expect(createTab).toHaveBeenCalledTimes(1);
    expect(createTab).toHaveBeenCalledWith({
      url: "https://elevenlabs.io/app/developers/api-keys",
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open API keys page" }));
    expect(createTab).toHaveBeenCalledTimes(2);
  });

  test("requests exact access from Validate and sends exactly one candidate command", async () => {
    const initial = createInitialState();
    const secret = "not-a-real-elevenlabs-key";
    const commands: unknown[] = [];
    const requestPermission = vi
      .spyOn(browser.permissions, "request")
      .mockResolvedValue(true as never);
    vi.spyOn(browser.tabs, "create").mockResolvedValue({ id: 7 } as never);
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "CONNECT_API_KEY_PROVIDER"
          ? {
              state: initial,
              report: report(
                {
                  elevenlabs: {
                    kind: "failure",
                    category: "credential_invalid",
                  },
                },
                "connect",
              ),
              result: "invalid_key",
            }
          : initial,
      );
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ElevenLabs" }),
    );
    const input = screen.getByLabelText("ElevenLabs API key");
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    await waitFor(() =>
      expect(requestPermission).toHaveBeenCalledWith({
        origins: ["https://api.elevenlabs.io/*"],
      }),
    );
    const guide = screen
      .getByRole("heading", { name: "Connect ElevenLabs" })
      .closest("section")!;
    expect(
      await within(guide).findByText("Enter a valid ElevenLabs API key."),
    ).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(commands).toEqual([
      { type: "GET_STATE" },
      {
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind: "elevenlabs",
        config: { kind: "fixed" },
      },
      {
        type: "RESOLVE_PROVIDER_PERMISSION",
        permissionIntentId: TEST_PERMISSION_INTENT,
        granted: true,
      },
      {
        type: "CONNECT_API_KEY_PROVIDER",
        providerKind: "elevenlabs",
        instanceId: "elevenlabs:default",
        config: { kind: "fixed" },
        apiKey: secret,
        permissionIntentId: TEST_PERMISSION_INTENT,
      },
    ]);
    expect(document.body).not.toHaveTextContent(secret);
  });

  test("does not send the API key command when optional access is declined", async () => {
    const state = createInitialState();
    const commands: unknown[] = [];
    vi.spyOn(browser.tabs, "create").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(browser.permissions, "request").mockResolvedValue(false as never);
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(state);
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ElevenLabs" }),
    );
    const input = screen.getByLabelText("ElevenLabs API key");
    fireEvent.change(input, { target: { value: "candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    const guide = screen
      .getByRole("heading", { name: "Connect ElevenLabs" })
      .closest("section")!;
    expect(
      await within(guide).findByText(/ElevenLabs access was not changed/i),
    ).toBeVisible();
    expect(input).toHaveValue("");
    expect(commands).toEqual([
      { type: "GET_STATE" },
      {
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind: "elevenlabs",
        config: { kind: "fixed" },
      },
      {
        type: "RESOLVE_PROVIDER_PERMISSION",
        permissionIntentId: TEST_PERMISSION_INTENT,
        granted: false,
      },
    ]);
  });

  test.each([
    [
      "insufficient_scope",
      "Allow User → Read and check any IP restrictions, then try again.",
    ],
    [
      "temporary_error",
      "ElevenLabs could not be validated right now. Your existing data and key are unchanged.",
    ],
  ] as const)(
    "keeps the guide open after %s",
    async (result, expected) => {
      const state = createInitialState();
      vi.spyOn(browser.tabs, "create").mockResolvedValue({ id: 7 } as never);
      vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
      installMessageHandler((message, respond) => {
        respond(
          message.type === "CONNECT_API_KEY_PROVIDER"
            ? { state, report: report({}, "connect"), result }
            : state,
        );
      });

      render(<App />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Connect ElevenLabs" }),
      );
      fireEvent.change(screen.getByLabelText("ElevenLabs API key"), {
        target: { value: "candidate" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

      const guide = screen
        .getByRole("heading", { name: "Connect ElevenLabs" })
        .closest("section")!;
      expect(await within(guide).findByText(expected)).toBeVisible();
      expect(
        screen.getByRole("heading", { name: "Connect ElevenLabs" }),
      ).toBeVisible();
    },
  );

  test("treats the fixed command-failure envelope as temporary", async () => {
    const state = createInitialState();
    vi.spyOn(browser.tabs, "create").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    installMessageHandler((message, respond) => {
      respond(
        message.type === "CONNECT_API_KEY_PROVIDER"
          ? { ok: false, error: "command_failed" }
          : state,
      );
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ElevenLabs" }),
    );
    fireEvent.change(screen.getByLabelText("ElevenLabs API key"), {
      target: { value: "candidate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    expect(
      await screen.findByText(
        "ElevenLabs could not be validated right now. Your existing data and key are unchanged.",
      ),
    ).toBeVisible();
  });

  test("commits the authoritative state and returns to Overview only on connected", async () => {
    const initial = createInitialState();
    const connected = createFixtureState(NOW);
    vi.spyOn(browser.tabs, "create").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    installMessageHandler((message, respond) => {
      respond(
        message.type === "CONNECT_API_KEY_PROVIDER"
          ? {
              state: connected,
              report: report(successfulOutcomes(connected), "connect"),
              result: "connected",
            }
          : initial,
      );
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ElevenLabs" }),
    );
    fireEvent.change(screen.getByLabelText("ElevenLabs API key"), {
      target: { value: "candidate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & connect" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Connected ElevenLabs.",
    );
    expect(
      screen.getByRole("article", { name: "ElevenLabs" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Connect ElevenLabs" }),
    ).not.toBeInTheDocument();
  });

  test("keeps existing ElevenLabs usage visible after a failed replacement", async () => {
    const state = createFixtureState(NOW);
    state.providers.find(
      (provider) => provider.providerId === "elevenlabs",
    )!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "failure", category: "credential_invalid" },
    };
    vi.spyOn(browser.tabs, "create").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    const commands: unknown[] = [];
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "CONNECT_API_KEY_PROVIDER"
          ? {
              state,
              report: report({}, "connect"),
              result: "invalid_key",
            }
          : state,
      );
    });

    render(<App />);
    const card = await screen.findByRole("article", { name: "ElevenLabs" });
    fireEvent.click(
      within(card).getByRole("button", { name: "Replace ElevenLabs API key" }),
    );
    fireEvent.change(screen.getByLabelText("ElevenLabs API key"), {
      target: { value: "replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & replace" }));

    const guide = screen
      .getByRole("heading", { name: "Replace ElevenLabs API key" })
      .closest("section")!;
    expect(
      await within(guide).findByText("Enter a valid ElevenLabs API key."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("article", { name: "ElevenLabs" })).toHaveTextContent(
      "25% used",
    );
    expect(commands).toContainEqual({
      type: "CONNECT_API_KEY_PROVIDER",
      providerKind: "elevenlabs",
      instanceId: "elevenlabs:default",
      config: { kind: "fixed" },
      apiKey: "replacement",
      permissionIntentId: TEST_PERMISSION_INTENT,
    });
  });
  test("offers a retry when the initial state load fails", async () => {
    const state = createFixtureState(NOW);
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockImplementationOnce(async () => toPublicState(state) as never);

    render(<App />);

    expect(await screen.findByText("Couldn’t load usage.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading usage" }));

    expect(await screen.findByText("ChatGPT")).toBeVisible();
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "GET_STATE" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "GET_STATE" });
  });

  test("offers the same retry when the worker returns no initial state", async () => {
    const state = createFixtureState(NOW);
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => toPublicState(state) as never);

    render(<App />);

    expect(await screen.findByText("Couldn’t load usage.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading usage" }));
    expect(await screen.findByText("ChatGPT")).toBeVisible();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test("ignores an older initial GET_STATE reply after a storage reload finishes", async () => {
    const stale = createFixtureState(NOW);
    stale.preferences.displayMode = "used";
    const fresh = structuredClone(stale);
    fresh.preferences.displayMode = "left";
    let finishInitial: ((value: unknown) => void) | undefined;
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInitial = resolve;
          }) as never,
      )
      .mockImplementation(async () => toPublicState(fresh) as never);

    render(<App />);
    await act(async () => saveState(fresh, NOW));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("radio", { name: "Left" })).toBeChecked();

    await act(async () => finishInitial?.(toPublicState(stale)));
    expect(screen.getByRole("radio", { name: "Left" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Used" })).not.toBeChecked();
  });

  test("keeps existing usage visible while manual refresh work is pending", async () => {
    const state = createFixtureState(NOW);
    let finishRefresh: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "REFRESH_ALL") {
        finishRefresh = respond;
        return;
      }
      respond(state);
    });

    render(<App />);

    expect(await screen.findByText("72% used")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));

    const pendingButton = screen.getByRole("button", { name: "Refreshing usage" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("72% used")).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: "ChatGPT" })).getByText(
        "Fetching usage…",
      ),
    ).toBeVisible();

    act(() =>
      finishRefresh?.({ state, report: report(successfulOutcomes(state)) }),
    );
    await waitFor(() => expect(pendingButton).toBeEnabled());
  });

  test.each([
    {
      name: "all attempted providers succeed",
      state: createFixtureState(NOW),
      outcomes: successfulOutcomes(createFixtureState(NOW)),
      expected: "Updated 6 providers.",
    },
    {
      name: "Kimi is the only provider needing a session",
      state: createFixtureState(NOW),
      outcomes: {
        ...successfulOutcomes(createFixtureState(NOW)),
        kimi: { kind: "deferred", reason: "session_required" } as const,
      },
      expected: "Updated 5 of 6. Kimi needs a browser session.",
    },
    {
      name: "mixed non-success outcomes need attention",
      state: createFixtureState(NOW),
      outcomes: {
        chatgpt: successfulOutcomes(createFixtureState(NOW)).chatgpt,
        claude: { kind: "failure", category: "signed_out" } as const,
        kimi: { kind: "deferred", reason: "session_required" } as const,
      },
      expected: "Updated 1 of 3. Some providers need attention.",
    },
    {
      name: "none of the attempted providers succeed",
      state: createFixtureState(NOW),
      outcomes: {
        chatgpt: { kind: "failure", category: "temporary_error" } as const,
        claude: { kind: "failure", category: "signed_out" } as const,
      },
      expected: "No providers updated. Existing data is unchanged.",
    },
  ])("announces a truthful manual summary when $name", async ({ state, outcomes, expected }) => {
    installMessageHandler((message, respond) => {
      respond(
        message.type === "REFRESH_ALL"
          ? { state, report: report(outcomes) }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));

    expect(await screen.findByRole("status")).toHaveTextContent(expected);
  });

  test("shows provider-scoped permission and fetch operations", async () => {
    const initialState = createInitialState();
    const connectedState = createFixtureState(NOW);
    let approvePermission: ((granted: boolean) => void) | undefined;
    let finishCollection: ((value: unknown) => void) | undefined;
    vi.spyOn(browser.permissions, "request").mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          approvePermission = resolve;
        }) as never,
    );
    installMessageHandler((message, respond) => {
      if (message.type === "CONNECT_BROWSER_PROVIDER") {
        finishCollection = respond;
        return;
      }
      respond(initialState);
    });

    render(<App />);
    const card = await screen.findByRole("article", { name: "ChatGPT" });
    fireEvent.click(within(card).getByRole("button", { name: "Connect ChatGPT" }));

    expect(await within(card).findByText("Requesting permission…")).toBeVisible();
    act(() => approvePermission?.(true));
    expect(await within(card).findByText("Fetching usage…")).toBeVisible();

    act(() =>
      finishCollection?.({
        state: connectedState,
        report: report(
          { chatgpt: successfulOutcomes(connectedState).chatgpt },
          "connect",
        ),
      }),
    );
    await waitFor(() =>
      expect(within(card).queryByText("Fetching usage…")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Updated 1 provider.");
  });

  test("announces a declined permission decision", async () => {
    const state = createInitialState();
    vi.spyOn(browser.permissions, "request").mockResolvedValue(false as never);
    installMessageHandler((_message, respond) => respond(state));

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ChatGPT" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "ChatGPT was not connected.",
    );
  });

  test("uses connect-specific recovery copy when permission request fails", async () => {
    const state = createInitialState();
    const commands: unknown[] = [];
    vi.spyOn(browser.permissions, "request").mockRejectedValue(
      new Error("permissions API unavailable") as never,
    );
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(state);
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ChatGPT" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t connect ChatGPT. Reload AI Limits and try again.",
    );
    expect(commands).toEqual([
      { type: "GET_STATE" },
      {
        type: "PREPARE_PROVIDER_PERMISSION",
        providerKind: "chatgpt",
        config: { kind: "fixed" },
      },
      {
        type: "ABANDON_PROVIDER_PERMISSION",
        permissionIntentId: TEST_PERMISSION_INTENT,
      },
    ]);
  });

  test("shows Kimi waiting only after the recovery boundary emits progress", async () => {
    const state = createFixtureState(NOW);
    let finishRefresh: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "REFRESH_ALL") {
        finishRefresh = respond;
        return;
      }
      respond(state);
    });

    render(<App />);
    const kimi = await screen.findByRole("article", { name: "Kimi" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));

    expect(within(kimi).getByText("Fetching usage…")).toBeVisible();
    expect(within(kimi).queryByText("Waiting for Kimi…")).not.toBeInTheDocument();

    act(() => {
      void browser.runtime.sendMessage({
        type: "PROVIDER_OPERATION",
        instanceId: "kimi:default",
        operation: "waiting_for_session",
      });
    });
    expect(await within(kimi).findByText("Waiting for Kimi…")).toBeVisible();
    expect(within(kimi).getByText("55% used")).toBeVisible();

    act(() =>
      finishRefresh?.({ state, report: report(successfulOutcomes(state)) }),
    );
    await waitFor(() =>
      expect(within(kimi).queryByText("Waiting for Kimi…")).not.toBeInTheDocument(),
    );
  });

  test("does not expose scheduled attempt state through an aria-live region", async () => {
    const state = createFixtureState(NOW);
    state.providers[2]!.lastAttempt = {
      trigger: "scheduled",
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      outcome: { kind: "deferred", reason: "session_required" },
    };
    installMessageHandler((_message, respond) => respond(state));

    render(<App />);

    expect(await screen.findByText("Kimi")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("re-announces identical provider refresh outcomes", async () => {
    const fixture = createFixtureState(0);
    const kimi = fixture.providers[2]!;
    kimi.lastAttempt = {
      trigger: "scheduled",
      startedAt: 1,
      finishedAt: 2,
      outcome: { kind: "deferred", reason: "session_required" },
    };
    const state: AppState = { ...fixture, providers: [kimi] };
    installMessageHandler((message, respond) => {
      respond(
        message.type === "REFRESH_INSTANCE"
          ? {
              state,
              report: report(
                { kimi: { kind: "deferred", reason: "session_required" } },
                "manual_provider",
              ),
            }
          : state,
      );
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh Kimi" }));
    const firstStatus = await screen.findByRole("status");
    expect(firstStatus).toHaveTextContent(
      "No providers updated. Existing data is unchanged.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh Kimi" }));
    await waitFor(() => expect(screen.getByRole("status")).not.toBe(firstStatus));
    expect(screen.getByRole("status")).toHaveTextContent(
      "No providers updated. Existing data is unchanged.",
    );
  });

  test("uses confirmation-failure copy when global refresh transport fails", async () => {
    const state = createFixtureState(NOW);
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "REFRESH_ALL") {
          throw new Error("response channel closed");
        }
        return toPublicControlResponse(
          message as Record<string, unknown>,
          state,
        ) as never;
      },
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh usage" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the refresh result. Check the latest usage before retrying.",
    );
  });

  test("uses confirmation-failure copy when provider refresh transport fails", async () => {
    const fixture = createFixtureState(0);
    const kimi = fixture.providers[2]!;
    kimi.lastAttempt = {
      trigger: "scheduled",
      startedAt: 1,
      finishedAt: 2,
      outcome: { kind: "deferred", reason: "session_required" },
    };
    const state: AppState = { ...fixture, providers: [kimi] };
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "REFRESH_INSTANCE") {
          throw new Error("response channel closed");
        }
        return toPublicState(state) as never;
      },
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh Kimi" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the Kimi refresh result. Check the latest usage before retrying.",
    );
  });

  test("uses confirmation-failure copy when connect transport fails", async () => {
    const state = createInitialState();
    const commands: Record<string, unknown>[] = [];
    vi.spyOn(browser.permissions, "request").mockResolvedValue(true as never);
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        commands.push(message as Record<string, unknown>);
        if ((message as { type?: string }).type === "CONNECT_BROWSER_PROVIDER") {
          throw new Error("response channel closed");
        }
        return toPublicControlResponse(
          message as Record<string, unknown>,
          state,
        ) as never;
      },
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect ChatGPT" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t confirm the ChatGPT refresh result. Check the latest usage before retrying.",
    );
    expect(commands.map(({ type }) => type)).toEqual([
      "GET_STATE",
      "PREPARE_PROVIDER_PERMISSION",
      "RESOLVE_PROVIDER_PERMISSION",
      "CONNECT_BROWSER_PROVIDER",
      "ABANDON_PROVIDER_PERMISSION",
    ]);
    expect(commands[1]).not.toHaveProperty("apiKey");
  });

  test("keeps the authoritative auto-refresh value when the command fails", async () => {
    const state = createFixtureState(NOW);
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        if ((message as { type?: string }).type === "SET_AUTO_REFRESH") {
          throw new Error("worker unavailable");
        }
        return toPublicState(state) as never;
      },
    );

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    fireEvent.click(autoRefresh);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t update automatic refresh.",
    );
    expect(autoRefresh).toBeChecked();
    expect(autoRefresh).toBeEnabled();
  });

  test("reverts a failed display-mode mutation and shows sanitized feedback", async () => {
    const state = createFixtureState(NOW);
    state.preferences.displayMode = "used";
    const commands: Record<string, unknown>[] = [];
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      async (message: unknown) => {
        commands.push(message as Record<string, unknown>);
        if ((message as { type?: string }).type === "SET_DISPLAY_MODE") {
          throw new Error("secret worker detail");
        }
        return toPublicState(state) as never;
      },
    );

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("radio", { name: "Left" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t update the display mode.",
    );
    expect(screen.getByRole("radio", { name: "Used" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Left" })).not.toBeChecked();
    expect(document.body).not.toHaveTextContent("secret worker detail");
    expect(commands.filter(({ type }) => type === "GET_STATE")).toHaveLength(2);
  });

  test("disables auto-refresh control until authoritative state returns", async () => {
    const state = createFixtureState(NOW);
    const disabledState = structuredClone(state);
    disabledState.preferences.autoRefresh = false;
    let finishToggle: ((value: unknown) => void) | undefined;
    installMessageHandler((message, respond) => {
      if (message.type === "SET_AUTO_REFRESH") {
        finishToggle = respond;
        return;
      }
      respond(state);
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    fireEvent.click(autoRefresh);

    expect(autoRefresh).toBeChecked();
    expect(autoRefresh).toBeDisabled();
    act(() => finishToggle?.(disabledState));
    await waitFor(() => expect(autoRefresh).not.toBeChecked());
    expect(autoRefresh).toBeEnabled();
  });

  test("pins the prior automatic-refresh value during pending storage events", async () => {
    const state = createFixtureState(NOW);
    const disabledState = structuredClone(state);
    disabledState.preferences.autoRefresh = false;
    let finishToggle: ((value: unknown) => void) | undefined;
    const commands: Record<string, unknown>[] = [];
    installMessageHandler((message, respond) => {
      commands.push(message);
      if (message.type === "SET_AUTO_REFRESH") {
        finishToggle = respond;
        return;
      }
      respond(state);
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const autoRefresh = screen.getByRole("switch", { name: "Automatic refresh" });
    fireEvent.click(autoRefresh);

    await act(async () => saveState(disabledState, NOW));
    await waitFor(() =>
      expect(
        commands.filter(({ type }) => type === "GET_STATE").length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(autoRefresh).toBeChecked();
    expect(autoRefresh).toBeDisabled();

    act(() => finishToggle?.(disabledState));
    await waitFor(() => expect(autoRefresh).not.toBeChecked());
    expect(autoRefresh).toBeEnabled();
  });

  test("announces a completed provider disconnect", async () => {
    const state = createFixtureState(NOW);
    const disconnected = structuredClone(state);
    disconnected.providers[0] = {
      providerId: "chatgpt",
      access: "required",
      history: [],
    };
    installMessageHandler((message, respond) => {
      respond(
        message.type === "DISCONNECT_INSTANCE"
          ? {
              state: disconnected,
              result: { ok: true, localDataDeleted: true },
            }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Disconnected ChatGPT and deleted its stored usage.",
    );
  });

  test("announces local disconnect success when browser permission cleanup fails", async () => {
    const state = createFixtureState(NOW);
    const disconnected = structuredClone(state);
    disconnected.providers[0] = {
      providerId: "chatgpt",
      access: "required",
      history: [],
    };
    installMessageHandler((message, respond) => {
      respond(
        message.type === "DISCONNECT_INSTANCE"
          ? {
              state: disconnected,
              result: {
                ok: false,
                error: "permission_removal_failed",
                localDataDeleted: true,
              },
            }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Deleted ChatGPT’s local usage. Browser access could not be removed.",
    );
    expect(
      screen.queryByRole("button", { name: "Disconnect ChatGPT" }),
    ).not.toBeInTheDocument();
  });

  test("routes settings mutations through service-worker commands", async () => {
    const state = createFixtureState(NOW);
    const commands: unknown[] = [];
    installMessageHandler((message, respond) => {
      commands.push(message);
      respond(
        message.type === "DELETE_LOCAL_DATA"
          ? { state: createInitialState(), result: "deleted" }
          : message.type === "DISCONNECT_INSTANCE"
            ? {
                state,
                result: { ok: true, localDataDeleted: true },
              }
            : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Automatic refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete all local data" }));

    await waitFor(() =>
      expect(commands).toEqual([
        { type: "GET_STATE" },
        { type: "SET_AUTO_REFRESH", enabled: false },
        { type: "DISCONNECT_INSTANCE", instanceId: "chatgpt:default" },
        { type: "DELETE_LOCAL_DATA" },
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Local usage data deleted and providers disconnected.",
    );
  });

  test("announces sanitized partial permission cleanup after deleting local data", async () => {
    const state = createFixtureState(NOW);
    installMessageHandler((message, respond) => {
      respond(
        message.type === "DELETE_LOCAL_DATA"
          ? {
              state: createInitialState(),
              result: "deleted_with_permission_errors",
            }
          : state,
      );
    });

    render(<App />);
    await screen.findByText("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm delete all local data" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Local usage data deleted. Some provider access could not be removed.",
    );
  });
});
