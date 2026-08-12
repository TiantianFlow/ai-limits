import type { UsageGroup } from "../../domain/model";
import type {
  CreditView,
  QuotaView,
  UsageGroupView,
} from "./components/ProviderCard";

export function usageGroupViews(
  groups: readonly UsageGroup[] | undefined,
  quotas: readonly QuotaView[],
  credits: readonly CreditView[],
): UsageGroupView[] {
  const quotaById = new Map(quotas.map((quota) => [quota.id, quota]));
  const creditById = new Map(credits.map((credit) => [credit.id, credit]));
  const authoredGroups = groups ?? [
    {
      id: "usage",
      label: "Usage",
      windowIds: quotas.map((quota) => quota.id),
      creditIds: credits.map((credit) => credit.id),
    },
  ];

  return authoredGroups.map((group) => ({
    id: group.id,
    label: group.label,
    ...(group.description === undefined
      ? {}
      : { description: group.description }),
    quotas: group.windowIds.flatMap((id) => {
      const quota = quotaById.get(id);
      return quota === undefined ? [] : [quota];
    }),
    credits: group.creditIds.flatMap((id) => {
      const credit = creditById.get(id);
      return credit === undefined ? [] : [credit];
    }),
  }));
}
