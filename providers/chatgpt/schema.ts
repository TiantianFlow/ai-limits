import { z } from "zod";

export const chatGptSessionSchema = z
  .object({
    accessToken: z.string().min(1).optional(),
  })
  .passthrough();

export const chatGptUsageWindowSchema = z
  .object({
    used_percent: z.number().finite(),
    reset_at: z.number().finite(),
    limit_window_seconds: z.number().finite().positive(),
  })
  .passthrough();

export const chatGptUsageSchema = z
  .object({
    plan_type: z.string().optional(),
    rate_limit: z
      .object({
        primary_window: chatGptUsageWindowSchema.optional(),
        secondary_window: chatGptUsageWindowSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ChatGptUsageWindow = z.infer<typeof chatGptUsageWindowSchema>;
