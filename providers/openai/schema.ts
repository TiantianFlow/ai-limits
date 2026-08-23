import { z } from "zod";

// Wire shapes follow the upstream reference implementation. `amount.value`
// accepts either a number or a numeric string.
// Credit-grant `expires_at` is unix seconds (fetcher line 172).

// Mirrors KeyedDecodingContainer.decodeFlexibleDoubleIfPresent: a finite
// number or numeric string; blank strings become absent; non-finite values
// fail the page.
const optionalFlexibleFiniteNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: "custom", message: "non-finite number" });
        return z.NEVER;
      }
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: "non-finite number" });
      return z.NEVER;
    }
    return parsed;
  });

const optionalInt = z.number().int().nullable().optional();

const pagedEnvelope = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    has_more: z.boolean(),
    next_page: z.string().nullable().optional(),
  });

export const openAiCostsResponseSchema = pagedEnvelope(
  z.object({
    start_time: z.number().int(),
    end_time: z.number().int(),
    results: z.array(
      z.object({
        amount: z
          .object({
            value: optionalFlexibleFiniteNumber,
            currency: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
        line_item: z.string().nullable().optional(),
      }),
    ),
  }),
);

export const openAiCompletionsResponseSchema = pagedEnvelope(
  z.object({
    start_time: z.number().int(),
    end_time: z.number().int(),
    results: z.array(
      z.object({
        input_tokens: optionalInt,
        input_cached_tokens: optionalInt,
        input_audio_tokens: optionalInt,
        output_tokens: optionalInt,
        output_audio_tokens: optionalInt,
        num_model_requests: optionalInt,
        model: z.string().nullable().optional(),
      }),
    ),
  }),
);

export const openAiCreditGrantsResponseSchema = z.object({
  total_granted: z.number().finite(),
  total_used: z.number().finite(),
  total_available: z.number().finite(),
  grants: z
    .object({
      data: z.array(
        z.object({
          grant_amount: z.number().finite().nullable().optional(),
          used_amount: z.number().finite().nullable().optional(),
          expires_at: z.number().finite().nullable().optional(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

export type OpenAiCostsResponse = z.infer<typeof openAiCostsResponseSchema>;
export type OpenAiCompletionsResponse = z.infer<
  typeof openAiCompletionsResponseSchema
>;
export type OpenAiCreditGrantsResponse = z.infer<
  typeof openAiCreditGrantsResponseSchema
>;
