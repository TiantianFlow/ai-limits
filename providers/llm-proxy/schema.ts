import { z } from "zod";

const optionalInt = z.number().int().nullable().optional();
const optionalFinite = z.number().finite().nullable().optional();

// Wire keys follow the upstream reference implementation. quota_groups is
// array-or-record on the wire and is parsed in the adapter.
export const llmProxyQuotaGroupSchema = z.object({
  remaining_percent: optionalFinite,
  reset_time: z.string().nullable().optional(),
});

export const llmProxyProviderStatsSchema = z.object({
  credential_count: optionalInt,
  active_count: optionalInt,
  exhausted_count: optionalInt,
  total_requests: optionalInt,
  tokens: z
    .object({
      input_cached: optionalInt,
      input_uncached: optionalInt,
      output: optionalInt,
    })
    .nullable()
    .optional(),
  approx_cost: optionalFinite,
  quota_groups: z.unknown().optional(),
});

export const llmProxyQuotaStatsSchema = z.object({
  providers: z.record(z.string(), llmProxyProviderStatsSchema),
  summary: z
    .object({
      total_requests: optionalInt,
      approx_cost: optionalFinite,
      total_tokens: optionalInt,
    })
    .nullable()
    .optional(),
});

export type LlmProxyQuotaStats = z.infer<typeof llmProxyQuotaStatsSchema>;
export type LlmProxyQuotaGroup = z.infer<typeof llmProxyQuotaGroupSchema>;
