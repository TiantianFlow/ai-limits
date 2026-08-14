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

  it("keeps generated labels globally unique from literal and chained labels", () => {
    const first = { ...baseInstance, userLabel: "Shared relay" };
    const second: ProviderInstanceView = {
      ...baseInstance,
      id: "newapi:22222222-2222-4222-8222-222222222222",
      userLabel: "Shared relay",
    };
    const generatedCandidate = "Shared relay · 11111111";
    const fullIdCandidate = `${generatedCandidate} · ${first.id}`;
    const countedCandidate = `${fullIdCandidate} · 2`;
    const literalCandidate: ProviderInstanceView = {
      ...baseInstance,
      id: "newapi:33333333-3333-4333-8333-333333333333",
      userLabel: generatedCandidate,
    };
    const literalFullId: ProviderInstanceView = {
      ...baseInstance,
      id: "newapi:44444444-4444-4444-8444-444444444444",
      userLabel: fullIdCandidate,
    };
    const literalCounter: ProviderInstanceView = {
      ...baseInstance,
      id: "newapi:55555555-5555-4555-8555-555555555555",
      userLabel: countedCandidate,
    };
    const instances = [
      first,
      second,
      literalCandidate,
      literalFullId,
      literalCounter,
    ];
    const expected = new Map([
      [first.id, `${fullIdCandidate} · 3`],
      [second.id, "Shared relay · 22222222"],
      [literalCandidate.id, generatedCandidate],
      [literalFullId.id, fullIdCandidate],
      [literalCounter.id, countedCandidate],
    ]);

    for (const ordered of [instances, [...instances].reverse()]) {
      const labels = instanceLabels(ordered);
      for (const [instanceId, label] of expected) {
        expect(labels.get(instanceId)).toBe(label);
      }
      expect(new Set(labels.values()).size).toBe(instances.length);
    }

    const afterDeletion = instanceLabels([
      first,
      literalCandidate,
      literalFullId,
      literalCounter,
    ]);
    expect(afterDeletion.get(first.id)).toBe("Shared relay");
    expect(new Set(afterDeletion.values()).size).toBe(4);
  });

  it("lengthens duplicate short UUID prefixes deterministically", () => {
    const first = { ...baseInstance, userLabel: "Shared prefix" };
    const second: ProviderInstanceView = {
      ...baseInstance,
      id: "newapi:11111111-2222-4222-8222-222222222222",
      userLabel: "Shared prefix",
    };

    const forward = instanceLabels([first, second]);
    const reversed = instanceLabels([second, first]);

    expect(forward.get(first.id)).toBe("Shared prefix · 11111111-1");
    expect(forward.get(second.id)).toBe("Shared prefix · 11111111-2");
    expect(reversed.get(first.id)).toBe("Shared prefix · 11111111-1");
    expect(reversed.get(second.id)).toBe("Shared prefix · 11111111-2");
  });
});
