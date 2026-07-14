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

/**
 * Hardcoded directive a human-seated agent runs until the LLM pipeline lands
 * (SPEC.md §8): charge the nearest enemy and fight. Phase 4 replaces it per
 * agent with LLM-produced directives — the behavior executor already treats it
 * as just one possible directive, not a special case.
 */
export const DEFAULT_DIRECTIVE: Directive = {
  stance: "aggressive",
  move_target: { type: "nearest_enemy" },
  engage_range: 300,
  target_priority: "closest",
  retreat_hp: 0,
  retreat_to: "away_from_enemy",
  acknowledgement: "Charging the nearest enemy.",
};

/**
 * Bot personalities that fill empty match slots (SPEC.md §8 Phase 3: "an
 * aggressor, a camper, a coward…"). Each is just an ordinary directive — a free
 * way to populate a match with no LLM.
 *
 * They're spread across the island's landmarks on purpose: only the hunter
 * roams, while the others hold different corners. So the early game is a
 * stand-off and it's the shrinking zone that squeezes the survivors together —
 * a real battle-royale arc that plays out over minutes, not a 15-second pile-up
 * at the center. Seats are assigned a shuffled subset each match (see MatchRoom),
 * so the mix and the winner vary.
 */
export const BOT_DIRECTIVES: readonly Directive[] = [
  // Hunter — roams and charges the nearest enemy to the death.
  DEFAULT_DIRECTIVE,
  // Castle guard — holds the castle, fights anything that enters its reach.
  // Camper engage ranges are kept short so holders only duel genuine intruders
  // at their post, not everyone whose path crosses theirs early on — the early
  // game stays a stand-off and the zone gets to shape the endgame.
  {
    stance: "hold_position",
    move_target: { type: "landmark", name: "castle" },
    engage_range: 120,
    target_priority: "closest",
    retreat_hp: 0.3,
    retreat_to: "castle",
    acknowledgement: "Holding the castle.",
  },
  // Gold baron — camps the gold mine and picks the biggest threat first.
  {
    stance: "hold_position",
    move_target: { type: "landmark", name: "gold_mine" },
    engage_range: 120,
    target_priority: "strongest",
    retreat_hp: 0.35,
    retreat_to: "gold_mine",
    acknowledgement: "Guarding the gold.",
  },
  // Lake lurker — defends the lake and pulls back there when hurt.
  {
    stance: "defensive",
    move_target: { type: "landmark", name: "lake" },
    engage_range: 120,
    target_priority: "closest",
    retreat_hp: 0.3,
    retreat_to: "lake",
    acknowledgement: "Lurking by the lake.",
  },
  // Coward — never picks a fight, just stays away from everyone (SPEC's runner);
  // usually the zone is what finally corners it.
  {
    stance: "evasive",
    move_target: null,
    engage_range: 0, // never attacks
    target_priority: "closest", // still needs a target to flee *from*
    retreat_hp: 0.6,
    retreat_to: "away_from_enemy",
    acknowledgement: "Staying out of everyone's way.",
  },
];
