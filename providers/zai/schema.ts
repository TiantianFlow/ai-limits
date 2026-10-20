import { z } from "zod";

const finiteNumber = z.number().finite();
const optionalCount = finiteNumber.nullable().optional();

// Client contract for GET /api/monitor/usage/quota/limit, the read-only
// request Z.ai's own GLM Coding Plan usage plugin makes. Entries of unknown
// types are kept loose here and skipped by the adapter.
export const zaiQuotaLimitSchema = z.object({
  type: z.string(),
  unit: z.number().int(),
  number: z.number().int(),
  // A 0–100 figure; the adapter clamps it.
  percentage: finiteNumber,
  usage: optionalCount,
  currentValue: optionalCount,
  remaining: optionalCount,
  nextResetTime: optionalCount,
});

export const zaiQuotaEnvelopeSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  success: z.boolean().optional(),
  msg: z.string().nullable().optional(),
  data: z
    .object({
      level: z.string().nullable().optional(),
      limits: z.array(z.unknown()),
    })
    .nullable()
    .optional(),
});

export type ZaiQuotaLimit = z.infer<typeof zaiQuotaLimitSchema>;
export type ZaiQuotaEnvelope = z.infer<typeof zaiQuotaEnvelopeSchema>;
