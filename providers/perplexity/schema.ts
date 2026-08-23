import { z } from "zod";

// Wire shapes follow the upstream reference implementation. Fields absent from
// that contract are omitted rather than invented.

// GET https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default
// The upstream implementation also tolerates camelCase spellings; the keys
// below are the canonical snake_case wire names.

const perplexityCreditGrantSchema = z
  .object({
    type: z.string(),
    amount_cents: z.number().finite(),
    // Unix seconds.
    expires_at_ts: z.number().finite().nullable().optional(),
  })
  .passthrough();

export const perplexityCreditsResponseSchema = z
  .object({
    balance_cents: z.number().finite(),
    renewal_date_ts: z.number().finite(),
    current_period_purchased_cents: z.number().finite(),
    credit_grants: z.array(perplexityCreditGrantSchema),
    total_usage_cents: z.number().finite(),
  })
  .passthrough();

export type PerplexityCreditsResponse = z.infer<
  typeof perplexityCreditsResponseSchema
>;
export type PerplexityCreditGrant = z.infer<typeof perplexityCreditGrantSchema>;
