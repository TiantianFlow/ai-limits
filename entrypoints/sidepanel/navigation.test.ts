import { describe, expect, it } from "vitest";

import type { ProviderInstanceId } from "../../domain/model";
import {
  navigateCockpit,
  type CockpitNavigationState,
  type CockpitScreen,
} from "./navigation";

const overview: CockpitScreen = { name: "overview" };
const chatGptInstance: ProviderInstanceId = "chatgpt:default";
const personalRelay: ProviderInstanceId =
  "newapi:11111111-1111-4111-8111-111111111111";
const workRelay: ProviderInstanceId =
  "newapi:22222222-2222-4222-8222-222222222222";

describe("navigateCockpit", () => {
  it("treats same-kind provider routes as distinct instance routes", () => {
    const personal: CockpitNavigationState = {
      current: { name: "provider", instanceId: personalRelay },
      backStack: [overview],
    };

    const work = navigateCockpit(personal, {
      type: "push",
      screen: { name: "provider", instanceId: workRelay },
    });

    expect(work).toEqual({
      current: { name: "provider", instanceId: workRelay },
      backStack: [overview, { name: "provider", instanceId: personalRelay }],
    });
  });

  it("pushes Provider and History so Back returns to the exact provider origin", () => {
    const initial: CockpitNavigationState = {
      current: overview,
      backStack: [],
    };

    const provider = navigateCockpit(initial, {
      type: "push",
      screen: { name: "provider", instanceId: chatGptInstance },
    });
    const history = navigateCockpit(provider, {
      type: "push",
      screen: {
        name: "history",
        instanceId: chatGptInstance,
        metricId: "weekly",
      },
    });

    expect(history).toEqual({
      current: {
        name: "history",
        instanceId: chatGptInstance,
        metricId: "weekly",
      },
      backStack: [overview, { name: "provider", instanceId: chatGptInstance }],
    });
    expect(navigateCockpit(history, { type: "pop" })).toEqual(provider);
  });

  it("returns from Settings to the Provider that opened it", () => {
    const provider: CockpitNavigationState = {
      current: { name: "provider", instanceId: chatGptInstance },
      backStack: [overview],
    };

    const settings = navigateCockpit(provider, {
      type: "push",
      screen: { name: "settings" },
    });

    expect(navigateCockpit(settings, { type: "pop" })).toEqual(provider);
  });

  it("returns from Add Provider to Settings", () => {
    const settings: CockpitNavigationState = {
      current: { name: "settings" },
      backStack: [overview],
    };

    const addProvider = navigateCockpit(settings, {
      type: "push",
      screen: { name: "add-provider" },
    });

    expect(navigateCockpit(addProvider, { type: "pop" })).toEqual(settings);
  });

  it("pushes the ElevenLabs API-key guide and returns to its exact origin", () => {
    const addProvider: CockpitNavigationState = {
      current: { name: "add-provider" },
      backStack: [overview],
    };

    const apiKeyGuide = navigateCockpit(addProvider, {
      type: "push",
      screen: {
        name: "api-key-connect",
        providerKind: "elevenlabs",
        mode: "connect",
      },
    });

    expect(apiKeyGuide.current).toEqual({
      name: "api-key-connect",
      providerKind: "elevenlabs",
      mode: "connect",
    });
    expect(navigateCockpit(apiKeyGuide, { type: "pop" })).toEqual(addProvider);
  });

  it("does not add the current screen to the stack twice", () => {
    const provider: CockpitNavigationState = {
      current: { name: "provider", instanceId: chatGptInstance },
      backStack: [overview],
    };

    expect(
      navigateCockpit(provider, { type: "push", screen: provider.current }),
    ).toBe(provider);
  });

  it("keeps the root screen when popping an empty stack", () => {
    const initial: CockpitNavigationState = {
      current: overview,
      backStack: [],
    };

    expect(navigateCockpit(initial, { type: "pop" })).toBe(initial);
  });

  it("clears the stack when returning home", () => {
    const history: CockpitNavigationState = {
      current: { name: "history", instanceId: chatGptInstance },
      backStack: [overview, { name: "provider", instanceId: chatGptInstance }],
    };

    expect(navigateCockpit(history, { type: "home" })).toEqual({
      current: overview,
      backStack: [],
    });
  });
});
