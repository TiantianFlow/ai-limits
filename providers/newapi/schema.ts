import { z } from "zod";

const finiteNonNegative = z.number().finite().nonnegative();

export const newApiStatusSchema = z.object({
  success: z.literal(true),
  data: z.object({
    system_name: z.string().trim().min(1),
    version: z.string().optional(),
  }),
});

export const newApiTokenUsageSchema = z.object({
  code: z.literal(true),
  data: z.object({
    name: z.string().trim().min(1),
    total_granted: finiteNonNegative,
    total_used: finiteNonNegative,
    total_available: finiteNonNegative,
    unlimited_quota: z.boolean(),
    expires_at: z.number().finite().optional(),
  }),
});

export type NewApiTokenUsage = z.infer<typeof newApiTokenUsageSchema>["data"];
