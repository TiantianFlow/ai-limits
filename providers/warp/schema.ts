import { z } from "zod";

const finiteNumber = z.number().finite();

// Client contract for the GetRequestLimitInfo GraphQL query that Warp's own
// open-source client sends to app.warp.dev/graphql/v2. Credit counts are
// integers; times are RFC 3339 strings.
export const warpRequestLimitInfoSchema = z.object({
  isUnlimited: z.boolean(),
  requestLimit: finiteNumber,
  requestsUsedSinceLastRefresh: finiteNumber,
  nextRefreshTime: z.string().nullable().optional(),
  requestLimitRefreshDuration: z.string().nullable().optional(),
});

export const warpBonusGrantSchema = z.object({
  grantType: z.string().nullable().optional(),
  requestCreditsGranted: finiteNumber,
  requestCreditsRemaining: finiteNumber,
  expiration: z.string().nullable().optional(),
});

export const warpRequestLimitResponseSchema = z.object({
  data: z
    .object({
      user: z
        .object({
          __typename: z.string().optional(),
          user: z
            .object({
              requestLimitInfo: z.unknown(),
              bonusGrants: z.array(z.unknown()).nullable().optional(),
              workspaces: z
                .array(
                  z.object({
                    bonusGrantsInfo: z
                      .object({
                        grants: z.array(z.unknown()).nullable().optional(),
                      })
                      .nullable()
                      .optional(),
                  }),
                )
                .nullable()
                .optional(),
            })
            .nullable()
            .optional(),
          error: z.object({ message: z.string().optional() }).nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.unknown()).nullable().optional(),
});

export type WarpRequestLimitInfo = z.infer<typeof warpRequestLimitInfoSchema>;
export type WarpBonusGrant = z.infer<typeof warpBonusGrantSchema>;
