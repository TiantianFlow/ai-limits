import { describe, expect, test } from "vitest";

import type { LegacyUsageGroup } from "../../domain/model";
import type {
  CreditView,
  QuotaView,
} from "./components/ProviderCard";
import { usageGroupViews } from "./usage-groups";

const quotas: QuotaView[] = [
  {
    id: "monthly",
    label: "A presentation label that must not define grouping",
    quotaPercent: 25,
    usedPercent: 25,
    paceLabel: "Pace unavailable",
  },
  {
    id: "weekly",
    label: "Weekly messages",
    quotaPercent: 10,
    usedPercent: 10,
    paceLabel: "Pace unavailable",
  },
];

const credits: CreditView[] = [
  { id: "extra", label: "Extra usage", value: "$2.00 used" },
];

describe("usageGroupViews", () => {
  test("resolves provider-authored groups from explicit measure references", () => {
    const groups: LegacyUsageGroup[] = [
      {
        id: "priority",
        label: "Priority usage",
        description: "Provider-authored hierarchy.",
        windowIds: ["weekly"],
        creditIds: ["extra"],
      },
      {
        id: "monthly",
        label: "Monthly usage",
        windowIds: ["monthly"],
        creditIds: [],
      },
    ];

    expect(usageGroupViews(groups, quotas, credits)).toEqual([
      {
        id: "priority",
        label: "Priority usage",
        description: "Provider-authored hierarchy.",
        quotas: [quotas[1]],
        credits: [credits[0]],
      },
      {
        id: "monthly",
        label: "Monthly usage",
        quotas: [quotas[0]],
        credits: [],
      },
    ]);
  });

  test("uses one generic Usage group when provider-authored groups are absent", () => {
    expect(usageGroupViews(undefined, quotas, credits)).toEqual([
      {
        id: "usage",
        label: "Usage",
        quotas,
        credits,
      },
    ]);
  });
});
