import { z } from "zod";

// Wire shape follows the upstream reference implementation. `status` is a
// string; `data.result[].value` is an array whose last element
// is a number or numeric string (lines 107-128). `error` is optional.

const prometheusScalar = z.union([z.number(), z.string()]);

export const groqPrometheusResponseSchema = z.object({
  status: z.string(),
  data: z
    .object({
      result: z.array(
        z.object({
          value: z.array(prometheusScalar).nullable().optional(),
        }),
      ),
    })
    .nullable()
    .optional(),
  error: z.string().nullable().optional(),
});

export type GroqPrometheusResponse = z.infer<
  typeof groqPrometheusResponseSchema
>;
