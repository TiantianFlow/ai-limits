import {
  isProviderInstanceId,
  type ProviderInstanceId,
} from "../domain/instances";

export type ProviderOperation =
  | "requesting_permission"
  | "fetching"
  | "waiting_for_session";

export interface ProviderOperationEvent {
  type: "PROVIDER_OPERATION";
  instanceId: ProviderInstanceId;
  operation: "waiting_for_session";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isProviderOperationEvent(
  value: unknown,
): value is ProviderOperationEvent {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === 3 &&
    Object.hasOwn(value, "type") &&
    Object.hasOwn(value, "instanceId") &&
    Object.hasOwn(value, "operation") &&
    value.type === "PROVIDER_OPERATION" &&
    isProviderInstanceId(value.instanceId) &&
    value.operation === "waiting_for_session"
  );
}
