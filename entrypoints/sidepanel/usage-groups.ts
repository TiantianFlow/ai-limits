import type { ProviderKind, UsageGroup } from "../../domain/public-protocol";
import {
  localizeGroupDescription,
  localizeGroupLabel,
} from "../../i18n/presentation";
import type {
  MetricValueView,
  QuotaView,
  UsageGroupView,
} from "./components/ProviderCard";

export function usageGroupViews(
  providerKind: ProviderKind,
  groups: readonly UsageGroup[] | undefined,
  quotas: readonly QuotaView[],
  values: readonly MetricValueView[],
): UsageGroupView[] {
  const quotaById = new Map(quotas.map((quota) => [quota.id, quota]));
  const valueById = new Map(values.map((metric) => [metric.id, metric]));
  const authoredGroups = groups ?? [
    {
      id: "usage",
      label: "Usage",
      metricIds: [...quotas, ...values].map((metric) => metric.id),
    },
  ];

  return authoredGroups.map((group) => {
    const description = localizeGroupDescription(providerKind, group);
    return {
      id: group.id,
      label: localizeGroupLabel(providerKind, group),
      ...(description === undefined ? {} : { description }),
      quotas: group.metricIds.flatMap((id) => {
        const quota = quotaById.get(id);
        return quota === undefined ? [] : [quota];
      }),
      values: group.metricIds.flatMap((id) => {
        const metric = valueById.get(id);
        return metric === undefined ? [] : [metric];
      }),
    };
  });
}
