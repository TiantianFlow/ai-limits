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
  type ProviderKind,
} from "../providers/catalog";
import { providerRegistry } from "../providers/registry";
export {
  isProviderOperationEvent,
  type ProviderOperation,
  type ProviderOperationEvent,
} from "./events";

const MAX_API_KEY_LENGTH = 4_096;
const MAX_LABEL_LENGTH = 128;

export interface ConnectApiKeyProviderCommand {
  type: "CONNECT_API_KEY_PROVIDER";
  providerKind: ApiKeyProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
  apiKey: string;
  permissionIntentId: string;
}

export interface PrepareProviderPermissionCommand {
  type: "PREPARE_PROVIDER_PERMISSION";
  providerKind: ProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
}

export type RuntimeCommand =
  | { type: "REFRESH_ALL" }
  | {
      type: "CONNECT_BROWSER_PROVIDER";
      providerKind: BrowserSessionProviderKind;
      permissionIntentId: string;
    }
  | PrepareProviderPermissionCommand
  | {
      type: "RESOLVE_PROVIDER_PERMISSION";
      permissionIntentId: string;
      granted: boolean;
    }
  | { type: "ABANDON_PROVIDER_PERMISSION"; permissionIntentId: string }
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

function isPermissionIntentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (!isRecord(value)) return false;

  if (value.type === "CONNECT_BROWSER_PROVIDER") {
    return (
      hasExactKeys(value, ["type", "providerKind", "permissionIntentId"]) &&
      isProviderId(value.providerKind) &&
      !isApiKeyProviderId(value.providerKind) &&
      isPermissionIntentId(value.permissionIntentId)
    );
  }

  if (value.type === "PREPARE_PROVIDER_PERMISSION") {
    return (
      hasAllowedKeys(
        value,
        ["type", "providerKind", "config"],
        ["instanceId", "userLabel"],
      ) &&
      isProviderId(value.providerKind) &&
      (!Object.hasOwn(value, "instanceId") ||
        (isProviderInstanceId(value.instanceId) &&
          value.instanceId.startsWith(`${value.providerKind}:`))) &&
      (!Object.hasOwn(value, "userLabel") || isLabel(value.userLabel)) &&
      isExactProviderConfig(value.config) &&
      providerRegistry[value.providerKind].normalizeConfig(value.config) !==
        undefined
    );
  }

  if (value.type === "RESOLVE_PROVIDER_PERMISSION") {
    return (
      hasExactKeys(value, ["type", "permissionIntentId", "granted"]) &&
      isPermissionIntentId(value.permissionIntentId) &&
      typeof value.granted === "boolean"
    );
  }

  if (value.type === "ABANDON_PROVIDER_PERMISSION") {
    return (
      hasExactKeys(value, ["type", "permissionIntentId"]) &&
      isPermissionIntentId(value.permissionIntentId)
    );
  }

  if (value.type === "CONNECT_API_KEY_PROVIDER") {
    if (
      !hasAllowedKeys(
        value,
        [
          "type",
          "providerKind",
          "config",
          "apiKey",
          "permissionIntentId",
        ],
        ["instanceId", "userLabel"],
      ) ||
      !isApiKeyProviderId(value.providerKind) ||
      typeof value.apiKey !== "string" ||
      !isPermissionIntentId(value.permissionIntentId) ||
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
    return (
      providerRegistry[value.providerKind].normalizeConfig(value.config) !==
      undefined
    );
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

export interface RuntimeCommandHandlers {
  refreshAll(): unknown;
  prepareProviderPermission(command: PrepareProviderPermissionCommand): unknown;
  resolveProviderPermission(permissionIntentId: string, granted: boolean): unknown;
  abandonProviderPermission(permissionIntentId: string): unknown;
  connectBrowserProvider(
    providerKind: BrowserSessionProviderKind,
    permissionIntentId: string,
  ): unknown;
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
      case "PREPARE_PROVIDER_PERMISSION":
        return handlers.prepareProviderPermission(value);
      case "RESOLVE_PROVIDER_PERMISSION":
        return handlers.resolveProviderPermission(
          value.permissionIntentId,
          value.granted,
        );
      case "ABANDON_PROVIDER_PERMISSION":
        return handlers.abandonProviderPermission(value.permissionIntentId);
      case "CONNECT_BROWSER_PROVIDER":
        return handlers.connectBrowserProvider(
          value.providerKind,
          value.permissionIntentId,
        );
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
