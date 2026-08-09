import { describe, expect, test, vi } from "vitest";

import type { ProviderId, ProviderRefreshOutcome } from "../domain/model";
import { refreshGrantedProviders } from "./refresh";

describe("refreshGrantedProviders", () => {
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
            providerId,
            source: "fixture",
            fetchedAt: 1_800_000_000_000,
            windows: [],
            credits: [],
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
            providerId: "chatgpt",
            source: "fixture",
            fetchedAt: 1_800_000_000_000,
            windows: [],
            credits: [],
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
});
