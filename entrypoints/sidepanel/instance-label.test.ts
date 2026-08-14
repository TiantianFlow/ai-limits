import { describe, expect, it } from "vitest";

import type { ProviderInstanceView } from "../../domain/public-protocol";
import {
  dynamicOriginHostname,
  instanceLabel,
  instanceLabels,
} from "./instance-label";

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

  it("uses provider identity to distinguish cross-provider default-ID collisions", () => {
    const chatGpt: ProviderInstanceView = {
      ...baseInstance,
      id: "chatgpt:default",
      providerKind: "chatgpt",
      snapshot: {
        providerKind: "chatgpt",
        accountLabel: "Shared account",
        source: "web-session",
        fetchedAt: 1,
        metrics: [],
      },
    };
    const claude: ProviderInstanceView = {
      ...baseInstance,
      id: "claude:default",
      providerKind: "claude",
      snapshot: {
        providerKind: "claude",
        accountLabel: "Shared account",
        source: "web-session",
        fetchedAt: 1,
        metrics: [],
      },
    };

    const forward = instanceLabels([chatGpt, claude]);
    const reversed = instanceLabels([claude, chatGpt]);

    expect([...forward.entries()]).toEqual([
      ["chatgpt:default", "Shared account · ChatGPT"],
      ["claude:default", "Shared account · Claude"],
    ]);
    expect(reversed.get(chatGpt.id)).toBe("Shared account · ChatGPT");
    expect(reversed.get(claude.id)).toBe("Shared account · Claude");
    expect(new Set(forward.values()).size).toBe(2);
  });

  it("distinguishes colliding explicit labels and keeps same-kind IDs stable", () => {
    const first = { ...baseInstance, userLabel: "Shared relay" };
    const second: ProviderInstanceView = {
      ...baseInstance,
      id: "newapi:22222222-2222-4222-8222-222222222222",
      userLabel: "Shared relay",
    };

    const forward = instanceLabels([first, second]);
    const reversed = instanceLabels([second, first]);

    expect(forward.get(first.id)).toBe("Shared relay · 11111111");
    expect(forward.get(second.id)).toBe("Shared relay · 22222222");
    expect(reversed.get(first.id)).toBe("Shared relay · 11111111");
    expect(reversed.get(second.id)).toBe("Shared relay · 22222222");
    expect(instanceLabels([second]).get(second.id)).toBe("Shared relay");
  });
});
