import { z } from "zod";

// Wire shape follows the upstream reference implementation. Balances are
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
