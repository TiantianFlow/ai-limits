import { z } from "zod";

const finiteNumber = z.number().finite();
const optionalFiniteNumber = finiteNumber.nullable().optional();

export const elevenLabsSubscriptionSchema = z.object({
  tier: z.string().trim().min(1),
  character_count: finiteNumber,
  character_limit: finiteNumber,
  next_character_count_reset_unix: optionalFiniteNumber,
  last_character_count_reset_unix: optionalFiniteNumber,
  character_refresh_period: z.string().nullable().optional(),
  voice_slots_used: optionalFiniteNumber,
  voice_limit: optionalFiniteNumber,
  professional_voice_slots_used_in_workspace: optionalFiniteNumber,
  professional_voice_limit: optionalFiniteNumber,
  voice_add_edit_counter: optionalFiniteNumber,
  max_voice_add_edits: optionalFiniteNumber,
});

export type ElevenLabsSubscription = z.infer<
  typeof elevenLabsSubscriptionSchema
>;
