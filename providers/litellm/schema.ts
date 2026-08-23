import { z } from "zod";

const optionalFinite = z.number().finite().nullable().optional();
const optionalText = z.string().nullable().optional();

// Wire keys from CodexBar LiteLLMUsageFetcher.swift LiteLLMKeyInfoResponse.Info
// CodingKeys (key_name, spend, expires, user_id, team_id). max_budget is optional
// because LiteLLMUsageFetcherTests.swift's observed /key/info fixture includes it;
// the Swift decoder does not require it.
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
