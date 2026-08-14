import { describe, expect, test } from "vitest";

import type { ProviderInstanceRecord } from "./model";
import { isProviderInstanceId } from "./model";

const now = Date.parse("2030-05-01T12:00:00.000Z");

describe("provider instance identity", () => {
  test.each([
    "chatgpt:default",
    "newapi:default",
    "newapi:550e8400-e29b-41d4-a716-446655440000",
  ])("accepts a durable provider instance ID: %s", (value) => {
    expect(isProviderInstanceId(value)).toBe(true);
  });

  test.each([
    "",
    " newapi:default",
    "newapi:default ",
    "newapi/default",
    "newapi\\default",
    "newapi:\nsecret",
    "unknown:default",
    "newapi:not-a-uuid",
    `newapi:${"x".repeat(129)}`,
  ])("rejects an unsafe or unstable provider instance ID: %j", (value) => {
    expect(isProviderInstanceId(value)).toBe(false);
  });

  test("keeps identity on the containing record rather than the usage snapshot", () => {
    const instance = {
      id: "newapi:550e8400-e29b-41d4-a716-446655440000",
      providerKind: "newapi",
      userLabel: "Personal relay",
      config: { kind: "dynamic-origin", baseUrl: "https://relay.example" },
      access: "granted",
      createdAt: now,
      history: [],
      snapshot: {
        providerKind: "newapi",
        source: "api-key",
        fetchedAt: now,
        metrics: [
          {
            type: "counter",
            id: "relay-key-usage",
            label: "API key usage",
            scope: "product",
            semantic: "consumed",
            value: 42,
            unit: "quota units",
          },
        ],
      },
    } satisfies ProviderInstanceRecord;

    expect(instance.id).toBe("newapi:550e8400-e29b-41d4-a716-446655440000");
    expect(instance.snapshot).not.toHaveProperty("instanceId");
  });
});
