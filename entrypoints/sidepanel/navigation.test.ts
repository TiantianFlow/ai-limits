import { describe, expect, it } from "vitest";

import type { ProviderId } from "../../domain/model";
import {
  navigateCockpit,
  type CockpitNavigationState,
  type CockpitScreen,
} from "./navigation";

const overview: CockpitScreen = { name: "overview" };
const chatGpt: ProviderId = "chatgpt";

describe("navigateCockpit", () => {
  it("pushes Provider and History so Back returns to the exact provider origin", () => {
    const initial: CockpitNavigationState = {
      current: overview,
      backStack: [],
    };

    const provider = navigateCockpit(initial, {
      type: "push",
      screen: { name: "provider", providerId: chatGpt },
    });
    const history = navigateCockpit(provider, {
      type: "push",
      screen: {
        name: "history",
        providerId: chatGpt,
        metricId: "weekly",
      },
    });

    expect(history).toEqual({
      current: {
        name: "history",
        providerId: chatGpt,
        metricId: "weekly",
      },
      backStack: [overview, { name: "provider", providerId: chatGpt }],
    });
    expect(navigateCockpit(history, { type: "pop" })).toEqual(provider);
  });

  it("returns from Settings to the Provider that opened it", () => {
    const provider: CockpitNavigationState = {
      current: { name: "provider", providerId: chatGpt },
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
        providerId: "elevenlabs",
        mode: "connect",
      },
    });

    expect(apiKeyGuide.current).toEqual({
      name: "api-key-connect",
      providerId: "elevenlabs",
      mode: "connect",
    });
    expect(navigateCockpit(apiKeyGuide, { type: "pop" })).toEqual(addProvider);
  });

  it("does not add the current screen to the stack twice", () => {
    const provider: CockpitNavigationState = {
      current: { name: "provider", providerId: chatGpt },
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
      current: { name: "history", providerId: chatGpt },
      backStack: [overview, { name: "provider", providerId: chatGpt }],
    };

    expect(navigateCockpit(history, { type: "home" })).toEqual({
      current: overview,
      backStack: [],
    });
  });
});
