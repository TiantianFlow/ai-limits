export type RuntimeCommand =
  | { type: "REFRESH_ALL" }
  | { type: "CONNECT_PROVIDER"; providerId: "chatgpt" }
  | { type: "GET_STATE" };

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
  if (command.type === "CONNECT_PROVIDER") {
    return (
      hasExactKeys(command, ["type", "providerId"]) &&
      command.providerId === "chatgpt"
    );
  }

  return (
    (command.type === "REFRESH_ALL" || command.type === "GET_STATE") &&
    hasExactKeys(command, ["type"])
  );
}

export interface RuntimeCommandHandlers {
  refreshAll(): unknown;
  connectProvider(providerId: "chatgpt"): unknown;
  getState(): unknown;
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
      case "CONNECT_PROVIDER":
        return handlers.connectProvider(value.providerId);
      case "GET_STATE":
        return handlers.getState();
    }
  };
}
