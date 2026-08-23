import { z } from "zod";

// Wire shapes follow the upstream reference implementation. Credits expose
// `data.total_credits` and `total_usage`; key data exposes `limit`,
// `limit_remaining`, `usage`, `usage_daily`, `usage_weekly`,
// `usage_monthly`, `limit_reset`, `rate_limit.requests`/`interval`
// lines 77-97). Credits totals are required finite numbers. Key enrichment
// fields are optional finite numbers; `limit_reset` is a string when present.

const finiteNumber = z.number().finite();
const optionalFiniteNumber = finiteNumber.nullable().optional();

export const openRouterCreditsResponseSchema = z.object({
  data: z.object({
    total_credits: finiteNumber,
    total_usage: finiteNumber,
  }),
});

export const openRouterKeyResponseSchema = z.object({
  data: z.object({
    limit: optionalFiniteNumber,
    limit_remaining: optionalFiniteNumber,
    usage: optionalFiniteNumber,
    usage_daily: optionalFiniteNumber,
    usage_weekly: optionalFiniteNumber,
    usage_monthly: optionalFiniteNumber,
    limit_reset: z.string().nullable().optional(),
    rate_limit: z
      .object({
        requests: z.number().int(),
        interval: z.string(),
      })
      .nullable()
      .optional(),
  }),
});

export type OpenRouterCreditsResponse = z.infer<
  typeof openRouterCreditsResponseSchema
>;
export type OpenRouterKeyResponse = z.infer<typeof openRouterKeyResponseSchema>;
export type OpenRouterKeyData = OpenRouterKeyResponse["data"];
