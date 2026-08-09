import type { ConnectableProviderId } from "../providers/registry";
import type { DisplayMode } from "../domain/model";

export type RuntimeCommand =
  | { type: "REFRESH_ALL" }
  | { type: "COLLECT_PROVIDER"; providerId: ConnectableProviderId }
  | { type: "REFRESH_PROVIDER"; providerId: ConnectableProviderId }
  | { type: "GET_STATE" }
  | { type: "SET_DISPLAY_MODE"; mode: DisplayMode }
  | { type: "SET_AUTO_REFRESH"; enabled: boolean }
  | { type: "DISCONNECT_PROVIDER"; providerId: ConnectableProviderId }
  | { type: "DELETE_LOCAL_DATA" };

export type ProviderOperation =
  | "requesting_permission"
  | "fetching"
  | "waiting_for_session";

export interface ProviderOperationEvent {
  type: "PROVIDER_OPERATION";
  providerId: "kimi";
  operation: "waiting_for_session";
}

export interface RuntimeCommandFailure {
  ok: false;
  error: "command_failed";
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (!value || typeof value !== "object") {
    return false;
  }

  const command = value as Record<string, unknown>;
  if (
    command.type === "COLLECT_PROVIDER" ||
    command.type === "REFRESH_PROVIDER" ||
    command.type === "DISCONNECT_PROVIDER"
  ) {
    return (
      hasExactKeys(command, ["type", "providerId"]) &&
      (command.providerId === "chatgpt" ||
        command.providerId === "claude" ||
        command.providerId === "kimi" ||
        command.providerId === "cursor")
    );
  }

  if (command.type === "SET_DISPLAY_MODE") {
    return (
      hasExactKeys(command, ["type", "mode"]) &&
      (command.mode === "used" || command.mode === "left")
    );
  }

  if (command.type === "SET_AUTO_REFRESH") {
    return (
      hasExactKeys(command, ["type", "enabled"]) &&
      typeof command.enabled === "boolean"
    );
  }

  return (
    (command.type === "REFRESH_ALL" ||
      command.type === "GET_STATE" ||
      command.type === "DELETE_LOCAL_DATA") &&
    hasExactKeys(command, ["type"])
  );
}

export function isProviderOperationEvent(
  value: unknown,
): value is ProviderOperationEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    hasExactKeys(event, ["type", "providerId", "operation"]) &&
    event.type === "PROVIDER_OPERATION" &&
    event.providerId === "kimi" &&
    event.operation === "waiting_for_session"
  );
}

export interface RuntimeCommandHandlers {
  refreshAll(): unknown;
  collectProvider(providerId: ConnectableProviderId): unknown;
  refreshProvider(providerId: ConnectableProviderId): unknown;
  getState(): unknown;
  setDisplayMode(mode: DisplayMode): unknown;
  setAutoRefresh(enabled: boolean): unknown;
  disconnectProvider(providerId: ConnectableProviderId): unknown;
  deleteLocalData(): unknown;
}

type RuntimeCommandHandler = (value: unknown) => unknown;

export function createChromeRuntimeMessageListener(
  handleCommand: RuntimeCommandHandler,
) {
  return (
    message: unknown,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (!isRuntimeCommand(message)) {
      return false;
    }

    void Promise.resolve()
      .then(() => handleCommand(message))
      .then(sendResponse, () =>
        sendResponse({
          ok: false,
          error: "command_failed",
        } satisfies RuntimeCommandFailure),
      );
    return true;
  };
}

export function createRuntimeCommandHandler(handlers: RuntimeCommandHandlers) {
  return (value: unknown): unknown => {
    if (!isRuntimeCommand(value)) {
      return undefined;
    }

    switch (value.type) {
      case "REFRESH_ALL":
        return handlers.refreshAll();
      case "COLLECT_PROVIDER":
        return handlers.collectProvider(value.providerId);
      case "REFRESH_PROVIDER":
        return handlers.refreshProvider(value.providerId);
      case "GET_STATE":
        return handlers.getState();
      case "SET_DISPLAY_MODE":
        return handlers.setDisplayMode(value.mode);
      case "SET_AUTO_REFRESH":
        return handlers.setAutoRefresh(value.enabled);
      case "DISCONNECT_PROVIDER":
        return handlers.disconnectProvider(value.providerId);
      case "DELETE_LOCAL_DATA":
        return handlers.deleteLocalData();
    }
  };
}
