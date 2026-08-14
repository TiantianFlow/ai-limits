import {
  isProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "../domain/instances";
import type { DisplayMode } from "../domain/model";
import {
  isApiKeyProviderId,
  isProviderId,
  type ApiKeyProviderKind,
  type BrowserSessionProviderKind,
} from "../providers/catalog";
import { normalizeProviderConfig } from "../providers/package-factories";

const MAX_API_KEY_LENGTH = 4_096;
const MAX_LABEL_LENGTH = 128;

export interface ConnectApiKeyProviderCommand {
  type: "CONNECT_API_KEY_PROVIDER";
  providerKind: ApiKeyProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
  apiKey: string;
}

export type RuntimeCommand =
  | { type: "REFRESH_ALL" }
  | {
      type: "CONNECT_BROWSER_PROVIDER";
      providerKind: BrowserSessionProviderKind;
    }
  | ConnectApiKeyProviderCommand
  | { type: "REFRESH_INSTANCE"; instanceId: ProviderInstanceId }
  | {
      type: "RENAME_INSTANCE";
      instanceId: ProviderInstanceId;
      userLabel?: string;
    }
  | { type: "DISCONNECT_INSTANCE"; instanceId: ProviderInstanceId }
  | { type: "GET_STATE" }
  | { type: "SET_DISPLAY_MODE"; mode: DisplayMode }
  | { type: "SET_AUTO_REFRESH"; enabled: boolean }
  | { type: "DELETE_LOCAL_DATA" };

export type ProviderOperation =
  | "requesting_permission"
  | "fetching"
  | "waiting_for_session";

export interface ProviderOperationEvent {
  type: "PROVIDER_OPERATION";
  instanceId: ProviderInstanceId;
  operation: "waiting_for_session";
}

export interface RuntimeCommandFailure {
  ok: false;
  error: "command_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return hasAllowedKeys(value, keys) && Object.keys(value).length === keys.length;
}

function isLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LABEL_LENGTH &&
    value.trim().length <= MAX_LABEL_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isExactProviderConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "fixed") return hasExactKeys(value, ["kind"]);
  return (
    value.kind === "dynamic-origin" &&
    hasExactKeys(value, ["kind", "baseUrl"]) &&
    typeof value.baseUrl === "string"
  );
}

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (!isRecord(value)) return false;

  if (value.type === "CONNECT_BROWSER_PROVIDER") {
    return (
      hasExactKeys(value, ["type", "providerKind"]) &&
      isProviderId(value.providerKind) &&
      !isApiKeyProviderId(value.providerKind)
    );
  }

  if (value.type === "CONNECT_API_KEY_PROVIDER") {
    if (
      !hasAllowedKeys(
        value,
        ["type", "providerKind", "config", "apiKey"],
        ["instanceId", "userLabel"],
      ) ||
      !isApiKeyProviderId(value.providerKind) ||
      typeof value.apiKey !== "string" ||
      value.apiKey.trim().length === 0 ||
      value.apiKey.length > MAX_API_KEY_LENGTH ||
      (Object.hasOwn(value, "instanceId") &&
        (!isProviderInstanceId(value.instanceId) ||
          !value.instanceId.startsWith(`${value.providerKind}:`))) ||
      (Object.hasOwn(value, "userLabel") && !isLabel(value.userLabel)) ||
      !isExactProviderConfig(value.config)
    ) {
      return false;
    }
    return normalizeProviderConfig(value.providerKind, value.config) !== undefined;
  }

  if (
    value.type === "REFRESH_INSTANCE" ||
    value.type === "DISCONNECT_INSTANCE"
  ) {
    return (
      hasExactKeys(value, ["type", "instanceId"]) &&
      isProviderInstanceId(value.instanceId)
    );
  }

  if (value.type === "RENAME_INSTANCE") {
    return (
      hasAllowedKeys(value, ["type", "instanceId"], ["userLabel"]) &&
      isProviderInstanceId(value.instanceId) &&
      (!Object.hasOwn(value, "userLabel") || isLabel(value.userLabel))
    );
  }

  if (value.type === "SET_DISPLAY_MODE") {
    return (
      hasExactKeys(value, ["type", "mode"]) &&
      (value.mode === "used" || value.mode === "left")
    );
  }
  if (value.type === "SET_AUTO_REFRESH") {
    return (
      hasExactKeys(value, ["type", "enabled"]) &&
      typeof value.enabled === "boolean"
    );
  }
  return (
    (value.type === "REFRESH_ALL" ||
      value.type === "GET_STATE" ||
      value.type === "DELETE_LOCAL_DATA") &&
    hasExactKeys(value, ["type"])
  );
}

export function isProviderOperationEvent(
  value: unknown,
): value is ProviderOperationEvent {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, ["type", "instanceId", "operation"]) &&
    value.type === "PROVIDER_OPERATION" &&
    isProviderInstanceId(value.instanceId) &&
    value.operation === "waiting_for_session"
  );
}

export interface RuntimeCommandHandlers {
  refreshAll(): unknown;
  connectBrowserProvider(providerKind: BrowserSessionProviderKind): unknown;
  connectApiKeyProvider(command: ConnectApiKeyProviderCommand): unknown;
  refreshInstance(instanceId: ProviderInstanceId): unknown;
  renameInstance(instanceId: ProviderInstanceId, userLabel?: string): unknown;
  disconnectInstance(instanceId: ProviderInstanceId): unknown;
  getState(): unknown;
  setDisplayMode(mode: DisplayMode): unknown;
  setAutoRefresh(enabled: boolean): unknown;
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
    if (!isRuntimeCommand(message)) return false;
    void Promise.resolve()
      .then(() => handleCommand(message))
      .then(sendResponse, () =>
        sendResponse({ ok: false, error: "command_failed" } satisfies RuntimeCommandFailure),
      );
    return true;
  };
}

export function createRuntimeCommandHandler(handlers: RuntimeCommandHandlers) {
  return (value: unknown): unknown => {
    if (!isRuntimeCommand(value)) return undefined;
    switch (value.type) {
      case "REFRESH_ALL":
        return handlers.refreshAll();
      case "CONNECT_BROWSER_PROVIDER":
        return handlers.connectBrowserProvider(value.providerKind);
      case "CONNECT_API_KEY_PROVIDER":
        return handlers.connectApiKeyProvider(value);
      case "REFRESH_INSTANCE":
        return handlers.refreshInstance(value.instanceId);
      case "RENAME_INSTANCE":
        return handlers.renameInstance(value.instanceId, value.userLabel);
      case "DISCONNECT_INSTANCE":
        return handlers.disconnectInstance(value.instanceId);
      case "GET_STATE":
        return handlers.getState();
      case "SET_DISPLAY_MODE":
        return handlers.setDisplayMode(value.mode);
      case "SET_AUTO_REFRESH":
        return handlers.setAutoRefresh(value.enabled);
      case "DELETE_LOCAL_DATA":
        return handlers.deleteLocalData();
    }
  };
}
