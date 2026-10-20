import {
  providerBalanceCategories,
  type BalanceMetric,
  type CounterMetric,
  type ProviderKind,
  type QuotaMetric,
  type UsageSnapshot,
} from "../../domain/public-protocol";

export function quotaMetrics(snapshot: UsageSnapshot): QuotaMetric[] {
  return snapshot.metrics.filter(
    (metric): metric is QuotaMetric => metric.type === "quota",
  );
}

export function counterMetrics(snapshot: UsageSnapshot): CounterMetric[] {
  return snapshot.metrics.filter(
    (metric): metric is CounterMetric => metric.type === "counter",
  );
}

export function balanceMetrics(snapshot: UsageSnapshot): BalanceMetric[] {
  return snapshot.metrics.filter(
    (metric): metric is BalanceMetric => metric.type === "balance",
  );
}

/**
 * Meters History can chart: quotas, plus balances for providers whose balance
 * is the primary signal. A pool-primary extra-credit balance stays off the
 * chart list.
 */
export function historyMetrics(
  snapshot: UsageSnapshot,
  providerKind: ProviderKind,
): (QuotaMetric | BalanceMetric)[] {
  const balances =
    providerBalanceCategories[providerKind] === "balance-primary"
      ? balanceMetrics(snapshot)
      : [];
  return [...quotaMetrics(snapshot), ...balances];
}
