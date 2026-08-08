import type { ConnectableProviderId } from "../providers/registry";
import type { DisplayMode } from "../domain/model";

export type RuntimeCommand =
  | { type: "REFRESH_ALL" }
  | { type: "COLLECT_PROVIDER"; providerId: ConnectableProviderId }
  | { type: "GET_STATE" }
  | { type: "SET_DISPLAY_MODE"; mode: DisplayMode };

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
  if (command.type === "COLLECT_PROVIDER") {
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

  return (
    (command.type === "REFRESH_ALL" || command.type === "GET_STATE") &&
    hasExactKeys(command, ["type"])
  );
}

export interface RuntimeCommandHandlers {
  refreshAll(): unknown;
  collectProvider(providerId: ConnectableProviderId): unknown;
  getState(): unknown;
  setDisplayMode(mode: DisplayMode): unknown;
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
      .then(sendResponse, () => sendResponse(undefined));
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
      case "GET_STATE":
        return handlers.getState();
      case "SET_DISPLAY_MODE":
        return handlers.setDisplayMode(value.mode);
    }
  };
}
