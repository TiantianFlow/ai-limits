import type {
  BalanceMetric,
  CounterMetric,
  QuotaMetric,
  UsageSnapshot,
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
