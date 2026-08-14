import { describe, expect, it } from "vitest";

import type { ProviderInstanceView } from "../../background/view-state";
import { dynamicOriginHostname, instanceLabel } from "./instance-label";

const baseInstance: ProviderInstanceView = {
  id: "newapi:11111111-1111-4111-8111-111111111111",
  providerKind: "newapi",
  access: "granted",
  createdAt: 1,
  history: [],
};

describe("instanceLabel", () => {
  it("uses the exact user, account, origin-hostname, provider priority", () => {
    expect(
      instanceLabel({
        ...baseInstance,
        userLabel: " Personal relay ",
        origin: "https://relay.example",
        snapshot: {
          providerKind: "newapi",
          accountLabel: "Reported account",
          source: "api-key",
          fetchedAt: 1,
          metrics: [],
        },
      }),
    ).toBe("Personal relay");
    expect(
      instanceLabel({
        ...baseInstance,
        userLabel: "   ",
        origin: "https://relay.example",
        snapshot: {
          providerKind: "newapi",
          accountLabel: " Reported account ",
          source: "api-key",
          fetchedAt: 1,
          metrics: [],
        },
      }),
    ).toBe("Reported account");
    expect(
      instanceLabel({
        ...baseInstance,
        userLabel: "",
        origin: "https://Relay.Example:8443/path",
      }),
    ).toBe("relay.example");
    expect(instanceLabel({ ...baseInstance, origin: "not a URL" })).toBe(
      "New API",
    );
  });

  it("never exposes URL credentials or paths as the dynamic-origin fallback", () => {
    expect(
      dynamicOriginHostname({
        origin: "https://person:secret@relay.example/private?token=secret",
      }),
    ).toBe("relay.example");
  });
});
