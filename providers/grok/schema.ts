import { z } from "zod";

export const grokSessionSchema = z
  .object({
    status: z.string().optional(),
    session: z
      .object({
        userId: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
    userId: z.unknown().optional(),
    user: z.unknown().optional(),
  })
  .passthrough();

export const grokRateLimitsSchema = z
  .object({
    windowSizeSeconds: z.number().finite().positive(),
    remainingQueries: z.number().finite(),
    totalQueries: z.number().finite(),
    waitTimeSeconds: z.unknown().optional(),
    remainingTokens: z.unknown().optional(),
    totalTokens: z.unknown().optional(),
  })
  .passthrough();

export const grokTokenFieldsSchema = z
  .object({
    remainingTokens: z.number().finite(),
    totalTokens: z.number().finite(),
  })
  .passthrough();

export const grokSubscriptionsSchema = z
  .object({
    subscriptions: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const grokSubscriptionItemSchema = z
  .object({
    tier: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export type GrokRateLimits = z.infer<typeof grokRateLimitsSchema>;
