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

export const cursorGrokStatusSchema = z.object({
  hasAvailableUsage: z.boolean().optional(),
  hasNonZeroIncludedLimit: z.boolean().optional(),
  usagePercent: z.number().finite().optional(),
  currentPeriodStart: z.iso.datetime({ offset: true }).optional(),
  nextResetTimestampUtc: z.iso.datetime({ offset: true }).optional(),
}).passthrough();

const cursorCreditAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .optional();

export const cursorCreditGrantSchema = z.object({
  total_cents: cursorCreditAmountSchema,
  used_cents: cursorCreditAmountSchema,
  totalCents: cursorCreditAmountSchema,
  usedCents: cursorCreditAmountSchema,
}).passthrough();

export const cursorCreditGrantsBalanceSchema = z.object({
  total_cents: cursorCreditAmountSchema,
  used_cents: cursorCreditAmountSchema,
  totalCents: cursorCreditAmountSchema,
  usedCents: cursorCreditAmountSchema,
  credit_grants: z.unknown().optional(),
  creditGrants: z.unknown().optional(),
  grants: z.unknown().optional(),
}).passthrough();

export type CursorPlanQuota = z.infer<typeof cursorPlanQuotaSchema>;
export type CursorQuota = z.infer<typeof cursorQuotaSchema>;
export type CursorUsageSummary = z.infer<typeof cursorUsageSummarySchema>;
export type CursorGrokStatus = z.infer<typeof cursorGrokStatusSchema>;
export type CursorCreditGrant = z.infer<typeof cursorCreditGrantSchema>;
export type CursorCreditGrantsBalance = z.infer<typeof cursorCreditGrantsBalanceSchema>;
