import { z } from "zod";

const finiteNumber = z.number().finite();

// Client contract for GET /api/billing/limits. usedPercent is a 0–100 figure;
// values a hair outside that range are accepted and clamped by the adapter.
export const factoryBillingWindowSchema = z.object({
  usedPercent: finiteNumber.min(-0.001).max(100.001),
  windowEnd: z.union([finiteNumber, z.string()]).nullable().optional(),
  secondsRemaining: finiteNumber.nullable().optional(),
});

export const factoryLimitPoolSchema = z.object({
  fiveHour: factoryBillingWindowSchema,
  weekly: factoryBillingWindowSchema,
  monthly: factoryBillingWindowSchema,
});

export const factoryBillingLimitsSchema = z.object({
  usesTokenRateLimitsBilling: z.boolean().optional(),
  limits: z
    .object({
      standard: factoryLimitPoolSchema,
      core: z.unknown().optional(),
    })
    .nullable()
    .optional(),
  extraUsageBalanceCents: finiteNumber.nullable().optional(),
  extraUsageAllowed: z.boolean().nullable().optional(),
});

// Older subscription usage. Pools may report a 0–1 usedRatio, token counts,
// or a simpler used/allowance pair. Dates are epoch milliseconds or seconds.
export const factoryLegacyPoolSchema = z.object({
  used: finiteNumber.nullable().optional(),
  allowance: finiteNumber.nullable().optional(),
  userTokens: finiteNumber.nullable().optional(),
  totalAllowance: finiteNumber.nullable().optional(),
  usedRatio: finiteNumber.nullable().optional(),
});

const factoryLegacyUsageBodySchema = z.object({
  startDate: finiteNumber.nullable().optional(),
  endDate: finiteNumber.nullable().optional(),
  standard: factoryLegacyPoolSchema.nullable().optional(),
  premium: factoryLegacyPoolSchema.nullable().optional(),
});

export const factoryLegacyUsageSchema = factoryLegacyUsageBodySchema.extend({
  usage: factoryLegacyUsageBodySchema.nullable().optional(),
});

export const factoryAuthSchema = z.object({
  user: z
    .object({
      id: z.string().trim().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  userProfile: z
    .object({
      id: z.string().trim().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  organization: z
    .object({
      subscription: z
        .object({
          factoryTier: z.string().trim().min(1).nullable().optional(),
          orbSubscription: z
            .object({
              plan: z
                .object({
                  name: z.string().trim().min(1).nullable().optional(),
                })
                .nullable()
                .optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export type FactoryBillingWindow = z.infer<typeof factoryBillingWindowSchema>;
export type FactoryLimitPool = z.infer<typeof factoryLimitPoolSchema>;
export type FactoryBillingLimits = z.infer<typeof factoryBillingLimitsSchema>;
export type FactoryLegacyPool = z.infer<typeof factoryLegacyPoolSchema>;
export type FactoryLegacyUsage = z.infer<typeof factoryLegacyUsageSchema>;
export type FactoryAuth = z.infer<typeof factoryAuthSchema>;
