import { describe, expect, expectTypeOf, test, vi } from "vitest";

import type {
  ProviderId,
  ProviderRefreshOutcome,
  RefreshTrigger,
} from "../domain/model";
import type { RefreshCollector } from "../providers/types";
import { refreshGrantedProviders } from "./refresh";

describe("refreshGrantedProviders", () => {
  test("requires production collectors to return a concrete outcome", () => {
    expectTypeOf<RefreshCollector>()
      .returns.resolves.toEqualTypeOf<ProviderRefreshOutcome>();
  });

  test("requires callers to identify the refresh trigger", () => {
    expectTypeOf<Parameters<typeof refreshGrantedProviders>[3]>()
      .toEqualTypeOf<RefreshTrigger>();
  });

  test("reports mixed refresh outcomes with the supplied timestamps", async () => {
    const hasPermission = vi.fn(async (providerId: ProviderId) =>
      providerId === "chatgpt" || providerId === "cursor",
    );
    const collect = vi.fn(
      async (providerId: ProviderId): Promise<ProviderRefreshOutcome> => {
        if (providerId === "cursor") throw new Error("unavailable");
        return {
          kind: "success",
          snapshot: {
            providerKind: providerId,
            source: "fixture",
            fetchedAt: 1_800_000_000_000,
            metrics: [],
          },
        };
      },
    );
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_800_000_000_000)
      .mockReturnValueOnce(1_800_000_000_250);

    const report = await refreshGrantedProviders(
      ["chatgpt", "claude", "kimi", "cursor"],
      hasPermission,
      collect,
      "manual_all",
      clock,
    );

    expect(report).toEqual({
      trigger: "manual_all",
      startedAt: 1_800_000_000_000,
      finishedAt: 1_800_000_000_250,
      providers: {
        chatgpt: {
          kind: "success",
          snapshot: {
            providerKind: "chatgpt",
            source: "fixture",
            fetchedAt: 1_800_000_000_000,
            metrics: [],
          },
        },
        claude: { kind: "skipped", reason: "permission_required" },
        kimi: { kind: "skipped", reason: "permission_required" },
        cursor: { kind: "failure", category: "temporary_error" },
      },
    });

    expect(hasPermission).toHaveBeenCalledTimes(4);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(collect).toHaveBeenCalledWith("chatgpt");
    expect(collect).toHaveBeenCalledWith("cursor");
  });

  test("starts granted providers in parallel", async () => {
    const started: ProviderId[] = [];
    const resolvers = new Map<
      ProviderId,
      (outcome: ProviderRefreshOutcome) => void
    >();
    const collect = (providerId: ProviderId) => {
      started.push(providerId);
      return new Promise<ProviderRefreshOutcome>((resolve) => {
        resolvers.set(providerId, resolve);
      });
    };

    const refreshing = refreshGrantedProviders(
      ["chatgpt", "claude"],
      async () => true,
      collect,
      "scheduled",
      () => 1_800_000_000_000,
    );

    await vi.waitFor(() => expect(started).toEqual(["chatgpt", "claude"]));
    resolvers.get("chatgpt")!({
      kind: "success",
      snapshot: {
        providerKind: "chatgpt",
        source: "fixture",
        fetchedAt: 1_800_000_000_000,
        metrics: [],
      },
    });
    resolvers.get("claude")!({
      kind: "success",
      snapshot: {
        providerKind: "claude",
        source: "fixture",
        fetchedAt: 1_800_000_000_000,
        metrics: [],
      },
    });

    await expect(refreshing).resolves.toMatchObject({
      trigger: "scheduled",
      providers: {
        chatgpt: { kind: "success" },
        claude: { kind: "success" },
      },
    });
  });
});
