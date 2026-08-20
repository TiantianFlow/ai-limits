import { describe, expect, test } from "vitest";

import {
  PRODUCT_GROK_BUILD,
  PRODUCT_GROK_CHAT,
  USAGE_PERIOD_WEEKLY,
  decodeGrokCreditsConfigResponse,
  encodeGrokCreditsConfigResponse,
} from "./credits-config";
import { inspectDecodedCreditsConfig } from "./usage-pool";

// Shape captured from a live SuperGrok Heavy account; values below are synthetic.
const SYNTHETIC_PERIOD_END = Date.parse("2030-06-15T12:00:00.000Z");

function weeklyPoolPayload() {
  return encodeGrokCreditsConfigResponse({
    creditUsagePercent: 12,
    isUnifiedBillingUser: true,
    currentPeriodType: USAGE_PERIOD_WEEKLY,
    currentPeriodEndMs: SYNTHETIC_PERIOD_END,
    prepaidBalanceCents: 0,
    productUsage: [
      { product: PRODUCT_GROK_BUILD, usagePercent: 8 },
      { product: PRODUCT_GROK_CHAT, usagePercent: 4 },
    ],
  });
}

describe("Grok credits protobuf", () => {
  test("maps a weekly pool whose product buckets sum to the parent", () => {
    const decoded = decodeGrokCreditsConfigResponse(weeklyPoolPayload());
    expect(decoded).toEqual({
      ok: true,
      config: {
        creditUsagePercent: 12,
        isUnifiedBillingUser: true,
        billingFlagPresent: true,
        currentPeriodType: USAGE_PERIOD_WEEKLY,
        currentPeriodEndMs: SYNTHETIC_PERIOD_END,
        prepaidBalanceCents: 0,
        productUsage: [
          { product: PRODUCT_GROK_BUILD, usagePercent: 8 },
          { product: PRODUCT_GROK_CHAT, usagePercent: 4 },
        ],
      },
    });
    if (!decoded.ok) {
      return;
    }
    expect(inspectDecodedCreditsConfig(decoded.config)).toEqual({
      kind: "metric",
      metric: {
        type: "quota",
        id: "weekly-pool",
        label: "Weekly usage pool",
        scope: "general",
        usedRatio: 0.12,
        cycle: {
          cadence: "calendar",
          resetsAt: SYNTHETIC_PERIOD_END,
        },
        segments: [
          { id: "grok-build", label: "Grok Build", usedRatio: 0.08 },
          { id: "chat", label: "Chat", usedRatio: 0.04 },
        ],
      },
    });
  });

  test("keeps the pool unsegmented when recognized product percents do not sum", () => {
    const decoded = decodeGrokCreditsConfigResponse(
      encodeGrokCreditsConfigResponse({
        creditUsagePercent: 12,
        isUnifiedBillingUser: true,
        currentPeriodType: USAGE_PERIOD_WEEKLY,
        currentPeriodEndMs: SYNTHETIC_PERIOD_END,
        productUsage: [
          { product: PRODUCT_GROK_BUILD, usagePercent: 8 },
          { product: PRODUCT_GROK_CHAT, usagePercent: 3 },
        ],
      }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const inspected = inspectDecodedCreditsConfig(decoded.config);
    expect(inspected.kind).toBe("metric");
    if (inspected.kind === "metric") {
      expect(inspected.metric.id).toBe("weekly-pool");
      expect(inspected.metric).not.toHaveProperty("segments");
    }
  });

  test("keeps the pool unsegmented when an unrecognized product has usage", () => {
    const decoded = decodeGrokCreditsConfigResponse(
      encodeGrokCreditsConfigResponse({
        creditUsagePercent: 13,
        isUnifiedBillingUser: true,
        currentPeriodType: USAGE_PERIOD_WEEKLY,
        currentPeriodEndMs: SYNTHETIC_PERIOD_END,
        productUsage: [
          { product: PRODUCT_GROK_BUILD, usagePercent: 8 },
          { product: PRODUCT_GROK_CHAT, usagePercent: 4 },
          { product: 5, usagePercent: 1 },
        ],
      }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const inspected = inspectDecodedCreditsConfig(decoded.config);
    expect(inspected.kind).toBe("metric");
    if (inspected.kind === "metric") {
      expect(inspected.metric).not.toHaveProperty("segments");
    }
  });

  test("decodes prepaid_balance cents including a present zero", () => {
    const zero = decodeGrokCreditsConfigResponse(
      encodeGrokCreditsConfigResponse({ prepaidBalanceCents: 0 }),
    );
    expect(zero).toMatchObject({
      ok: true,
      config: { prepaidBalanceCents: 0 },
    });

    const nonzero = decodeGrokCreditsConfigResponse(
      encodeGrokCreditsConfigResponse({ prepaidBalanceCents: 1_500 }),
    );
    expect(nonzero).toMatchObject({
      ok: true,
      config: { prepaidBalanceCents: 1_500 },
    });
  });

  test("does not invent duration when current_period.start is absent", () => {
    const decoded = decodeGrokCreditsConfigResponse(weeklyPoolPayload());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const inspected = inspectDecodedCreditsConfig(decoded.config);
    expect(inspected.kind).toBe("metric");
    if (inspected.kind === "metric") {
      expect(inspected.metric.cycle).not.toHaveProperty("durationMs");
      expect(inspected.metric.cycle).not.toHaveProperty("startedAt");
    }
  });
});
