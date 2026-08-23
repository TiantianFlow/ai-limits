import { z } from "zod";

// Wire shape sourced from CodexBar
// Sources/CodexBarCore/Providers/Moonshot/MoonshotUsageFetcher.swift
// (`MoonshotBalanceResponse`/`MoonshotBalanceData`, lines 58-75). Balances are
// numeric JSON doubles.
export const moonshotBalanceResponseSchema = z.object({
  code: z.number().finite(),
  status: z.boolean(),
  scode: z.string().optional(),
  data: z.object({
    available_balance: z.number().finite(),
    voucher_balance: z.number().finite().optional(),
    cash_balance: z.number().finite().optional(),
  }),
});

export type MoonshotBalanceResponse = z.infer<
  typeof moonshotBalanceResponseSchema
>;
