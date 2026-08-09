import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const optionalFiniteNumber = z.number().finite().nullable().optional();

export const cursorQuotaSchema = z.object({
  enabled: z.boolean(),
  used: optionalFiniteNumber,
  limit: optionalFiniteNumber,
  remaining: optionalFiniteNumber,
}).passthrough();

export const cursorPlanQuotaSchema = cursorQuotaSchema.extend({
  autoPercentUsed: optionalFiniteNumber,
  apiPercentUsed: optionalFiniteNumber,
  totalPercentUsed: optionalFiniteNumber,
});

export const cursorUsageSummarySchema = z.object({
  billingCycleStart: z.iso.datetime({ offset: true }),
  billingCycleEnd: z.iso.datetime({ offset: true }),
  membershipType: nonEmptyString,
  individualUsage: z.object({
    plan: cursorPlanQuotaSchema.nullable().optional(),
    overall: cursorQuotaSchema.nullable().optional(),
    onDemand: cursorQuotaSchema.nullable().optional(),
  }).passthrough().nullable().optional(),
  teamUsage: z.object({
    pooled: cursorQuotaSchema.nullable().optional(),
    onDemand: cursorQuotaSchema.nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

export type CursorPlanQuota = z.infer<typeof cursorPlanQuotaSchema>;
export type CursorQuota = z.infer<typeof cursorQuotaSchema>;
export type CursorUsageSummary = z.infer<typeof cursorUsageSummarySchema>;
