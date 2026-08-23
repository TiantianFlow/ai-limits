import { z } from "zod";

const finiteNumber = z.number().finite();
const optionalFinite = finiteNumber.nullable().optional();
const optionalText = z.string().nullable().optional();

// Shape from CodexBar Sources/CodexBarCore/Resources/Plugins/sub2api.js.
export const sub2apiQuotaSchema = z.object({
  limit: finiteNumber,
  used: finiteNumber,
  remaining: finiteNumber,
  unit: optionalText,
});

export const sub2apiSubscriptionSchema = z.object({
  daily_usage_usd: optionalFinite,
  weekly_usage_usd: optionalFinite,
  monthly_usage_usd: optionalFinite,
  daily_limit_usd: optionalFinite,
  weekly_limit_usd: optionalFinite,
  monthly_limit_usd: optionalFinite,
  expires_at: optionalText,
});

export const sub2apiRateLimitSchema = z.object({
  window: z.string().trim().min(1),
  limit: finiteNumber,
  used: finiteNumber,
  remaining: finiteNumber,
  reset_at: optionalText,
});

export const sub2apiUsageSchema = z.object({
  mode: optionalText,
  isValid: z.boolean().nullable().optional(),
  status: optionalText,
  planName: optionalText,
  remaining: optionalFinite,
  balance: optionalFinite,
  unit: optionalText,
  expires_at: optionalText,
  quota: sub2apiQuotaSchema.nullable().optional(),
  subscription: sub2apiSubscriptionSchema.nullable().optional(),
  rate_limits: z.array(sub2apiRateLimitSchema).nullable().optional(),
});

export type Sub2ApiUsage = z.infer<typeof sub2apiUsageSchema>;
