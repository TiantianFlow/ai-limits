import { z } from "zod";

// Wire shapes follow the upstream reference implementation. Slugs derive from
// `accountId`, then `id`, then the last path segment of `name`.
// `totalCost.units` is a string decimal; `nanos` is an integer fraction.
export const fireworksAccountsResponseSchema = z.object({
  accounts: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
        accountId: z.string().nullable().optional(),
        id: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  nextPageToken: z.string().nullable().optional(),
});

const fireworksMoneySchema = z.object({
  currencyCode: z.string().nullable().optional(),
  nanos: z.number().int().nullable().optional(),
  units: z.string().nullable().optional(),
});

export const fireworksBillingSummarySchema = z.object({
  lineItems: z
    .array(
      z
        .object({
          totalCost: fireworksMoneySchema.nullable().optional(),
        })
        .loose(),
    )
    .nullable()
    .optional(),
});

export type FireworksAccountsResponse = z.infer<
  typeof fireworksAccountsResponseSchema
>;
export type FireworksBillingSummary = z.infer<
  typeof fireworksBillingSummarySchema
>;
