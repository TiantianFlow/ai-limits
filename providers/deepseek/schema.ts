import { z } from "zod";

// Wire shape sourced from CodexBar
// Sources/CodexBarCore/Providers/DeepSeek/DeepSeekUsageFetcher.swift
// (`DeepSeekBalanceResponse`/`DeepSeekBalanceInfo`, lines 8-30). Balances are
// string-typed decimals on the wire.
const decimalString = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: "non-numeric balance" });
      return z.NEVER;
    }
    return parsed;
  });

const deepSeekBalanceInfoSchema = z.object({
  currency: z.string().trim().min(1),
  total_balance: decimalString,
  granted_balance: decimalString.optional(),
  topped_up_balance: decimalString.optional(),
});

export const deepSeekBalanceResponseSchema = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(deepSeekBalanceInfoSchema),
});

export type DeepSeekBalanceInfo = z.infer<typeof deepSeekBalanceInfoSchema>;
export type DeepSeekBalanceResponse = z.infer<
  typeof deepSeekBalanceResponseSchema
>;
