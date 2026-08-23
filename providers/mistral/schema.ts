import { z } from "zod";

// Wire shapes follow the upstream reference implementation. Fields absent from
// that contract are omitted rather than invented.

// GET https://admin.mistral.ai/api/billing/v2/usage?month=<m>&year=<y>

// Per-entry usage record.
const mistralUsageEntrySchema = z
  .object({
    timestamp: z.string().optional(),
    value: z.number().finite().nullable().optional(),
    value_paid: z.number().finite().nullable().optional(),
    billing_metric: z.string().optional(),
    billing_group: z.string().optional(),
    // billing_display_name, usage_type, and event_type are unused here.
  })
  .passthrough();

// Per-model buckets.
const mistralModelUsageDataSchema = z
  .object({
    input: z.array(mistralUsageEntrySchema).nullable().optional(), // :51
    output: z.array(mistralUsageEntrySchema).nullable().optional(), // :52
    cached: z.array(mistralUsageEntrySchema).nullable().optional(), // :53
  })
  .passthrough();

// Category wrapper.
const mistralModelUsageCategorySchema = z
  .object({
    models: z.record(z.string(), mistralModelUsageDataSchema).nullable().optional(),
  })
  .passthrough();

// Price row.
const mistralPriceSchema = z
  .object({
    billing_metric: z.string().optional(), // :79
    billing_group: z.string().optional(), // :80
    price: z.string().optional(), // :81
  })
  .passthrough();

export const mistralBillingResponseSchema = z
  .object({
    completion: mistralModelUsageCategorySchema.nullable().optional(), // :7
    currency: z.string().nullable().optional(), // :19
    start_date: z.string().nullable().optional(), // :17-18,31
    end_date: z.string().nullable().optional(), // :17-18,32
    prices: z.array(mistralPriceSchema).nullable().optional(), // :21
    // ocr/connectors/audio (:8,9,12), libraries_api (:10,25), fine_tuning
    // (:11,26), vibe_usage (:13,27) are established but not needed for the
    // spend summary; omitted rather than invented.
  })
  .passthrough();

// GET https://admin.mistral.ai/api/billing/credits
export const mistralCreditsResponseSchema = z
  .object({
    wallet_amount: z.number().finite(), // :566,573 (required Double)
    credit_notes_amount: z.number().finite().nullable().optional(), // :567,574
    ongoing_usage_balance: z.number().finite().nullable().optional(), // :568,575
    currency: z.string().min(1), // :569,572 (required String)
  })
  .passthrough();

export type MistralBillingResponse = z.infer<typeof mistralBillingResponseSchema>;
export type MistralCreditsResponse = z.infer<typeof mistralCreditsResponseSchema>;
