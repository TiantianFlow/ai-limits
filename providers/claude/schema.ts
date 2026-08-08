import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const minorCurrencyUnits = z.number().finite().int().nonnegative();
const positiveMinorCurrencyUnits = z.number().finite().int().positive();
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

export const claudeOrganizationListSchema = z.array(z.unknown()).min(1);

export const claudeOrganizationSchema = z.object({
  uuid: nonEmptyString,
  name: nonEmptyString.nullable().optional(),
  capabilities: z.array(nonEmptyString).optional(),
});

export const claudeUsageWindowSchema = z.object({
  utilization: z.number().finite().min(0).max(100),
  resets_at: z.iso.datetime({ offset: true }).nullable(),
});

export const claudeScopedLimitSchema = z.object({
  kind: z.literal("weekly_scoped"),
  percent: z.number().finite().min(0).max(100),
  resets_at: z.iso.datetime({ offset: true }),
  scope: z.object({
    model: z.object({
      display_name: nonEmptyString.refine(
        (value) => /[a-z0-9]/i.test(value.normalize("NFKD")),
        "Expected a model name with a stable identifier",
      ),
    }),
  }),
});

const claudeDisabledExtraUsageSchema = z.object({
  is_enabled: z.literal(false),
  used_credits: minorCurrencyUnits.nullable().optional(),
  monthly_limit: minorCurrencyUnits.nullable().optional(),
  currency: currencyCode.nullable().optional(),
});

const claudeEnabledExtraUsageSchema = z.object({
  is_enabled: z.literal(true),
  used_credits: minorCurrencyUnits,
  monthly_limit: positiveMinorCurrencyUnits,
  currency: currencyCode,
});

export const claudeExtraUsageSchema = z.union([
  claudeDisabledExtraUsageSchema,
  claudeEnabledExtraUsageSchema,
]);

export const claudeUsageSchema = z.object({
  five_hour: claudeUsageWindowSchema.nullable().optional(),
  seven_day: claudeUsageWindowSchema.nullable().optional(),
  seven_day_opus: claudeUsageWindowSchema.nullable().optional(),
  seven_day_sonnet: claudeUsageWindowSchema.nullable().optional(),
  limits: z.array(z.unknown()).nullable().optional(),
  extra_usage: z.unknown().nullable().optional(),
});

export const claudeAccountSchema = z.object({
  email_address: nonEmptyString.nullable().optional(),
});

export type ClaudeOrganization = z.infer<typeof claudeOrganizationSchema>;
export type ClaudeExtraUsage = z.infer<typeof claudeExtraUsageSchema>;
export type ClaudeScopedLimit = z.infer<typeof claudeScopedLimitSchema>;
export type ClaudeUsage = z.infer<typeof claudeUsageSchema>;
export type ClaudeUsageWindow = z.infer<typeof claudeUsageWindowSchema>;
