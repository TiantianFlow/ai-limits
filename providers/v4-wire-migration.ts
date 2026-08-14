import type { MetricCycle, MetricScope, ProviderId } from "../domain/model";

interface ConvertedReleasedV4Wire {
  snapshot?: unknown;
  history?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function metricScope(
  providerId: ProviderId,
  id: unknown,
  kind: unknown,
): MetricScope {
  if (kind === "model") return "model";
  if (kind === "feature") return "feature";
  if (providerId === "elevenlabs" && id === "monthly-credits") {
    return "product";
  }
  return "general";
}

function metricCycle(
  providerId: ProviderId,
  kind: unknown,
  value: Record<string, unknown>,
): MetricCycle | undefined {
  const hasTiming =
    value.startedAt !== undefined ||
    value.resetsAt !== undefined ||
    value.durationMs !== undefined;
  if (!hasTiming) return undefined;

  const cadence =
    kind === "calendar" || (providerId === "cursor" && kind === "model")
      ? "calendar"
      : "rolling";
  return {
    cadence,
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt as number }),
    ...(value.resetsAt === undefined ? {} : { resetsAt: value.resetsAt as number }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs as number }),
  };
}

function convertWindow(
  value: unknown,
  providerId: ProviderId,
): Record<string, unknown> | undefined {
  if (
    !isRecord(value) ||
    !["rolling", "calendar", "model", "feature"].includes(value.kind as string) ||
    (value.sourceSemantics !== "used" && value.sourceSemantics !== "remaining")
  ) {
    return undefined;
  }

  const cycle = metricCycle(providerId, value.kind, value);
  return {
    type: "quota",
    id: value.id,
    label: value.label,
    scope: metricScope(providerId, value.id, value.kind),
    usedRatio: value.usedRatio,
    ...(value.used === undefined ? {} : { used: value.used }),
    ...(value.limit === undefined ? {} : { limit: value.limit }),
    ...(value.unit === undefined ? {} : { unit: value.unit }),
    ...(cycle === undefined ? {} : { cycle }),
    ...(value.segments === undefined ? {} : { segments: value.segments }),
  };
}

function creditCycle(value: Record<string, unknown>): MetricCycle | undefined {
  return value.resetsAt === undefined
    ? undefined
    : { cadence: "calendar", resetsAt: value.resetsAt as number };
}

function convertCredit(
  value: unknown,
  providerId: ProviderId,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const cycle = creditCycle(value);
  const base = {
    id: value.id,
    label: value.label,
    scope: "product",
    unit: value.unit,
    ...(cycle === undefined ? {} : { cycle }),
  };

  if (providerId === "chatgpt") {
    return {
      ...base,
      type: "balance",
      value: value.remaining,
      ...(value.limit === undefined ? {} : { initialLimit: value.limit }),
    };
  }

  if (providerId === "claude" || providerId === "cursor") {
    return {
      ...base,
      type: "counter",
      semantic: "spent",
      value: value.used,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
    };
  }

  if (providerId === "newapi") {
    return {
      ...base,
      type: "counter",
      semantic: "consumed",
      value: value.used,
      ...(value.limit === undefined ? {} : { limit: value.limit }),
    };
  }

  return undefined;
}

function convertGroups(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return value;

  return value.map((group) => {
    if (!isRecord(group)) return group;
    if (!Array.isArray(group.windowIds) || !Array.isArray(group.creditIds)) {
      return group;
    }
    const windowIds = group.windowIds;
    const creditIds = group.creditIds;
    return {
      id: group.id,
      label: group.label,
      ...(group.description === undefined ? {} : { description: group.description }),
      metricIds: [...windowIds, ...creditIds],
    };
  });
}

function convertSnapshot(
  value: unknown,
  providerId: ProviderId,
): Record<string, unknown> | undefined {
  if (
    !isRecord(value) ||
    value.providerId !== providerId ||
    !Array.isArray(value.windows) ||
    !Array.isArray(value.credits)
  ) {
    return undefined;
  }

  const windows = value.windows.map((window) => convertWindow(window, providerId));
  const credits = value.credits.map((credit) => convertCredit(credit, providerId));
  if (
    windows.some((window) => window === undefined) ||
    credits.some((credit) => credit === undefined)
  ) {
    return undefined;
  }

  const usageGroups = convertGroups(value.usageGroups);
  return {
    providerKind: providerId,
    ...(value.accountLabel === undefined ? {} : { accountLabel: value.accountLabel }),
    ...(value.planLabel === undefined ? {} : { planLabel: value.planLabel }),
    source: value.source,
    fetchedAt: value.fetchedAt,
    metrics: [...windows, ...credits],
    ...(usageGroups === undefined ? {} : { usageGroups }),
  };
}

function quotaCadences(snapshot: Record<string, unknown> | undefined) {
  const cadences = new Map<string, MetricCycle["cadence"]>();
  if (!snapshot || !Array.isArray(snapshot.metrics)) return cadences;
  for (const metric of snapshot.metrics) {
    if (
      isRecord(metric) &&
      metric.type === "quota" &&
      typeof metric.id === "string" &&
      isRecord(metric.cycle) &&
      (metric.cycle.cadence === "rolling" || metric.cycle.cadence === "calendar")
    ) {
      cadences.set(metric.id, metric.cycle.cadence);
    }
  }
  return cadences;
}

function convertHistory(
  value: unknown,
  cadences: ReadonlyMap<string, MetricCycle["cadence"]>,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((observation) => {
    if (!isRecord(observation) || !Array.isArray(observation.windows)) {
      return observation;
    }
    return {
      observedAt: observation.observedAt,
      metrics: observation.windows.map((sample) => {
        if (!isRecord(sample)) return sample;
        const cadence =
          typeof sample.windowId === "string"
            ? cadences.get(sample.windowId)
            : undefined;
        const hasCycle =
          cadence !== undefined ||
          sample.startedAt !== undefined ||
          sample.resetsAt !== undefined ||
          sample.durationMs !== undefined;
        return {
          type: "quota",
          metricId: sample.windowId,
          usedRatio: sample.usedRatio,
          ...(hasCycle
            ? {
                cycle: {
                  ...(cadence === undefined ? {} : { cadence }),
                  ...(sample.startedAt === undefined
                    ? {}
                    : { startedAt: sample.startedAt }),
                  ...(sample.resetsAt === undefined
                    ? {}
                    : { resetsAt: sample.resetsAt }),
                  ...(sample.durationMs === undefined
                    ? {}
                    : { durationMs: sample.durationMs }),
                },
              }
            : {}),
        };
      }),
    };
  });
}

/** Converts only the released 0.2.3/V4 storage wire shape into Task 2 input. */
export function convertReleasedV4ProviderWire(
  stored: Record<string, unknown>,
  providerId: ProviderId,
): ConvertedReleasedV4Wire {
  const snapshot = convertSnapshot(stored.snapshot, providerId);
  return {
    ...(snapshot === undefined ? {} : { snapshot }),
    history: convertHistory(stored.history, quotaCadences(snapshot)),
  };
}
