import { z } from "zod";

// Wire shapes follow the upstream reference implementation. Checklist money
// fields are USD; the usage endpoint reports `total_cost` in cents.
export const deepInfraChecklistSchema = z.object({
  stripe_balance: z.number().finite(),
  recent: z.number().finite(),
  limit: z.number().finite().nullable().optional(),
  suspended: z.boolean().optional(),
  suspend_reason: z.string().nullable().optional(),
});

export const deepInfraUsageSchema = z.object({
  months: z.array(
    z.object({
      period: z.string(),
      total_cost: z.number().finite(),
    }),
  ),
  initial_month: z.string().nullable().optional(),
});

export type DeepInfraChecklist = z.infer<typeof deepInfraChecklistSchema>;
export type DeepInfraUsage = z.infer<typeof deepInfraUsageSchema>;
