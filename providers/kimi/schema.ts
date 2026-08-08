import { z } from "zod";

const finiteNumericString = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a finite decimal string")
  .refine((value) => Number.isFinite(Number(value)), "Expected a finite number");

const positiveIntegerString = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "Expected a positive integer string")
  .refine((value) => Number.isSafeInteger(Number(value)), "Expected a safe integer");

export const kimiTimeUnitSchema = z.enum([
  "TIME_UNIT_MINUTE",
  "TIME_UNIT_HOUR",
  "TIME_UNIT_DAY",
]);

export const kimiUsageSchema: z.ZodType<KimiUsage> = z.lazy(() =>
  z.object({
    limit: finiteNumericString,
    used: finiteNumericString.optional(),
    remaining: finiteNumericString.optional(),
    reset_time: z.iso.datetime({ offset: true }),
    time_unit: kimiTimeUnitSchema,
    time_value: positiveIntegerString,
    nested_usage: z.array(kimiUsageSchema).optional(),
  }),
);

export const kimiUsageResponseSchema = z.object({
  usage: kimiUsageSchema,
});

export interface KimiUsage {
  limit: string;
  used?: string;
  remaining?: string;
  reset_time: string;
  time_unit: z.infer<typeof kimiTimeUnitSchema>;
  time_value: string;
  nested_usage?: KimiUsage[];
}
