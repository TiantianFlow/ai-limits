import { z } from "zod";

const finiteNumber = z.number().finite();

export const cursorQuotaSchema = z.object({
  used: finiteNumber.optional(),
  limit: finiteNumber.optional(),
  percentUsed: finiteNumber.optional(),
}).passthrough();

export const cursorUsageSummarySchema = z.object({
  billingCycleStart: z.iso.datetime({ offset: true }),
  billingCycleEnd: z.iso.datetime({ offset: true }),
  totalPercentUsed: finiteNumber.optional(),
  planUsage: cursorQuotaSchema.optional(),
  overallUsage: cursorQuotaSchema.optional(),
  enterpriseUsage: cursorQuotaSchema.optional(),
  teamUsage: cursorQuotaSchema.optional(),
  pooledUsage: cursorQuotaSchema.optional(),
  onDemandUsage: cursorQuotaSchema.optional(),
  lanes: z.array(cursorQuotaSchema).optional(),
  usageLanes: z.array(cursorQuotaSchema).optional(),
}).passthrough();

export const cursorIdentitySchema = z.object({
  email: z.string().trim().min(1).optional(),
  plan: z.string().trim().min(1).optional(),
  planName: z.string().trim().min(1).optional(),
}).passthrough();

export type CursorQuota = z.infer<typeof cursorQuotaSchema>;
export type CursorUsageSummary = z.infer<typeof cursorUsageSummarySchema>;
