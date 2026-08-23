import { z } from "zod";

const integer = z.number().int();
const optionalInteger = integer.nullable().optional();

// Shape from CodexBar Sources/CodexBarCore/Resources/Plugins/clawrouter.js.
export const clawRouterUsageSchema = z.object({
  budget: z.object({
    configured: z.boolean(),
    ledger: z.string(),
    limitMicros: optionalInteger,
    spentMicros: optionalInteger,
    remainingMicros: optionalInteger,
    windowKey: z.string().nullable().optional(),
  }),
  usage: z.object({
    summary: z.object({
      requestCount: integer,
      successCount: integer,
      errorCount: integer,
      inputTokens: integer,
      outputTokens: integer,
      totalTokens: integer,
      actualCostMicros: integer,
    }),
    providers: z.array(
      z.object({
        provider: z.string(),
        requestCount: integer,
        successCount: integer,
        errorCount: integer,
        totalTokens: integer,
        actualCostMicros: integer,
      }),
    ),
  }),
});

export type ClawRouterUsage = z.infer<typeof clawRouterUsageSchema>;
