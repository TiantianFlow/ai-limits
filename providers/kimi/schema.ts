import { z } from "zod";

const finiteNumericString = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a finite decimal string")
  .refine((value) => Number.isFinite(Number(value)), "Expected a finite number");

export const kimiRatioSchema = z.number().finite().min(0).max(1);

export const kimiRateLimitStatSchema = z
  .object({
    ratio: kimiRatioSchema,
    enabled: z.boolean().optional(),
    resetTime: z.iso.datetime({ offset: true }).optional(),
  })
  .passthrough();

export const kimiSubscriptionBalanceSchema = z
  .object({
    amountUsedRatio: kimiRatioSchema,
    kimiCodeUsedRatio: kimiRatioSchema.optional(),
    expireTime: z.iso.datetime({ offset: true }).optional(),
  })
  .passthrough();

export const kimiSubscriptionStatsSchema = z
  .object({
    subscriptionBalance: z.unknown().optional(),
    ratelimitCode5h: z.unknown().optional(),
    ratelimitCode7d: z.unknown().optional(),
  })
  .passthrough();

export const kimiSubscriptionSchema = z
  .object({
    subscription: z
      .object({
        goods: z
          .object({
            title: z.string().trim().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export const kimiTimeUnitSchema = z.enum([
  "TIME_UNIT_MINUTE",
  "TIME_UNIT_HOUR",
  "TIME_UNIT_DAY",
]);

export const kimiUsageDetailSchema = z.object({
  limit: finiteNumericString,
  used: finiteNumericString.optional(),
  remaining: finiteNumericString.optional(),
  resetTime: z.iso.datetime({ offset: true }),
});

export const kimiUsageLimitSchema = z.object({
  window: z.object({
    duration: z.number().finite().positive(),
    timeUnit: kimiTimeUnitSchema,
  }),
  detail: kimiUsageDetailSchema,
});

export const kimiCodingUsageSchema = z.object({
  scope: z.literal("FEATURE_CODING"),
  detail: kimiUsageDetailSchema,
  limits: z.array(kimiUsageLimitSchema),
});

export const kimiUsageResponseSchema = z.object({
  usages: z.array(z.unknown()),
});

export type KimiUsageDetail = z.infer<typeof kimiUsageDetailSchema>;
export type KimiUsageLimit = z.infer<typeof kimiUsageLimitSchema>;
export type KimiRateLimitStat = z.infer<typeof kimiRateLimitStatSchema>;
