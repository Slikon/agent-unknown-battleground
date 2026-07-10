import { z } from "zod";
import { LANDMARK_NAMES } from "./constants";

/**
 * The single contract between the LLM and the game engine (SPEC.md §4).
 *
 * Phase 0 note: this is a *stub* — the schema shape is authoritative, but
 * nothing consumes it yet. The LLM pipeline that produces directives and the
 * behavior executor that runs them arrive in later phases. Keep this schema as
 * narrow as possible: every extra field makes the prompt more expensive and
 * adds bugs.
 *
 * The JSON Schema handed to Ollama's structured output is generated from THIS
 * object (via zod-to-json-schema) in Phase 4 — it must never be hand-written
 * in a second place.
 */
export const DirectiveSchema = z.object({
  // Overall behavior manner.
  stance: z.enum(["aggressive", "defensive", "evasive", "hold_position"]),

  // Where to head. null = decide based on stance.
  move_target: z.union([
    z.object({ type: z.literal("point"), x: z.number(), y: z.number() }),
    z.object({ type: z.literal("landmark"), name: z.enum(LANDMARK_NAMES) }),
    z.object({ type: z.literal("nearest_enemy") }),
    z.null(),
  ]),

  // Distance (in pixels) at which combat may be engaged; 0 = never attack.
  engage_range: z.number().min(0).max(400),

  // Who to hit first.
  target_priority: z.enum(["closest", "weakest", "strongest", "ignore"]),

  // HP threshold (0..1) for retreating, and where to retreat to.
  retreat_hp: z.number().min(0).max(1),
  retreat_to: z.enum([...LANDMARK_NAMES, "away_from_enemy"]),

  // A one-liner "understanding" of the order — shown to the player as the
  // agent's thought. The only free-text field, hard-capped for safety.
  acknowledgement: z.string().max(120),
});

/** The validated, structured order a single agent executes every tick. */
export type Directive = z.infer<typeof DirectiveSchema>;
