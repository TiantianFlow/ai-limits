import { z } from "zod";

const optionalFinite = z.number().finite().nullable().optional();
const optionalText = z.string().nullable().optional();

// Wire keys follow the upstream reference implementation: key_name, spend,
// expires, user_id, and team_id. max_budget is optional because an observed
// /key/info fixture includes it while the decoder does not require it.
export const liteLlmKeyInfoSchema = z.object({
  info: z.object({
    key_name: optionalText,
    spend: optionalFinite,
    expires: optionalText,
    user_id: optionalText,
    team_id: optionalText,
    max_budget: optionalFinite,
  }),
});

export type LiteLlmKeyInfo = z.infer<typeof liteLlmKeyInfoSchema>["info"];
