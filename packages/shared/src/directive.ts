import { z } from "zod";
import { LANDMARK_NAMES } from "./constants";

/**
 * The single contract between the LLM and the game engine (SPEC.md §4). The
 * behavior executor (`packages/server/src/game/BehaviorExecutor.ts`) runs any
 * value of this type as its per-tick state machine — hardcoded bot personas,
 * the human defaults below, and Phase 4's LLM-produced directives are all just
 * ordinary `Directive`s to it, never special-cased. Keep this schema as narrow
 * as possible: every extra field makes the prompt more expensive and adds bugs.
 *
 * The JSON Schema handed to Ollama's structured output (`DIRECTIVE_JSON_SCHEMA`
 * in `./llm.ts`) is generated from THIS object — it must never be hand-written
 * in a second place.
 *
 * Every field carries a `.describe()`, and those strings are load-bearing: they
 * are the ONLY place the model learns what a field means, since `z.toJSONSchema`
 * emits them as JSON Schema `description` keywords and the system prompt never
 * explains the fields. Field semantics must live here rather than in `//`
 * comments — a comment reaches the next developer, a `.describe()` reaches both
 * the developer and the model. Read them as prompt text, and re-run
 * `scripts/test-llm.ts` after editing one.
 */
export const DirectiveSchema = z.object({
  stance: z
    .enum(["aggressive", "defensive", "evasive", "hold_position"])
    .describe(
      "Overall behavior manner. aggressive = seek out enemies and fight them; " +
        "defensive = hold ground but fight back when approached; " +
        "evasive = avoid all fighting and keep away from enemies; " +
        "hold_position = stay at move_target and only fight what comes within engage_range.",
    ),

  move_target: z
    .union([
      z.object({ type: z.literal("point"), x: z.number(), y: z.number() }),
      z.object({ type: z.literal("landmark"), name: z.enum(LANDMARK_NAMES) }),
      z.object({ type: z.literal("nearest_enemy") }),
      z.null(),
    ])
    .describe(
      "Where to head. Use {type:'point', x, y} when the player names explicit " +
        "coordinates or numbers (e.g. 'go to x=300 y=1600'). Use " +
        "{type:'landmark', name} for a named place on the map. Use " +
        "{type:'nearest_enemy'} to chase down whoever is closest. Use null to " +
        "let stance decide.",
    ),

  // Phrased as a decision list because this model picks a number off a worked
  // list far more reliably than it interprets a described scale — the earlier
  // "0 = never ... 400 = maximum" phrasing answered 1000 for "only fight if they
  // come close". Grammar does not enforce min/max, so `sanitize` still clamps.
  engage_range: z
    .number()
    .min(0)
    .max(400)
    .describe(
      "Pixels within which this unit may start a fight. Choose by what the player " +
        "asked: 'do not fight / don't touch anyone / stop attacking' -> 0. " +
        "'only fight if they come close / defend the spot' -> 120. " +
        "'fight normally' -> 300. 'attack everything on sight' -> 400. " +
        "0 means this unit never attacks anyone.",
    ),

  target_priority: z
    .enum(["closest", "weakest", "strongest", "ignore"])
    .describe(
      "Which enemy to attack first when several are within engage_range. " +
        "ignore = do not pick targets at all.",
    ),

  // Fraction, not percent — but the model reliably answers in percent anyway and
  // cannot be prompted out of it, so LlmDirectiveService's `sanitize` converts
  // (1,100] -> [0,1] before this schema ever sees the value. See DECISIONS.md.
  retreat_hp: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Retreat once HP falls below this share of maximum HP. " +
        "0.5 = retreat at half HP. 0.25 = retreat at a quarter. " +
        "0 = never retreat, fight to the death.",
    ),

  retreat_to: z
    .enum([...LANDMARK_NAMES, "away_from_enemy"])
    .describe(
      "Where to run once HP drops below retreat_hp. " +
        "away_from_enemy = simply flee from whoever is nearest.",
    ),

  acknowledgement: z
    .string()
    .max(120)
    .describe(
      "One short line confirming the order, written from the soldier's point of " +
        "view, in the same language the player used. Shown to the player as the " +
        "agent's thought. Maximum 120 characters.",
    ),
});

/** The validated, structured order a single agent executes every tick. */
export type Directive = z.infer<typeof DirectiveSchema>;

/**
 * Hardcoded directive a human-seated agent ran before Phase 4 (SPEC.md §8):
 * charge the nearest enemy and fight. Kept as the aggressive bot persona
 * (`BOT_DIRECTIVES[0]`, the "hunter") and for anything that still wants a
 * sensible non-null default; human seats now start on `humanInitialDirective()`
 * instead (see below).
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
 * Initial directive for a human-seated agent (Phase 4 — deviation from the
 * Phase 2 hardcode, see DECISIONS.md). `DEFAULT_DIRECTIVE`'s aggressive
 * "charge and die fast" behavior fights this phase's whole point: a player
 * needs their agent to survive long enough to type an order. This holds near
 * spawn and only fights what comes within melee-adjacent range, retreating
 * early — a defensive baseline until the player's first order overrides it.
 * Bots keep their existing personality pool (`BOT_DIRECTIVES`) unchanged.
 */
/**
 * What a human seat runs until its player types something: hold your ground and
 * defend yourself, so you live long enough to give an order.
 *
 * `move_target` anchors to the agent's own spawn rather than the `null` that
 * would express "stay put" more directly, and that is deliberate — `null` reads
 * the same to the executor (`resolveMoveTarget` returns null either way, and the
 * unit stands), but not to the model. A null `move_target` in the current
 * directive is *sticky*: the model will not replace it, so the player's very
 * first order — the SPEC §8 done-criterion "run to the lake and don't touch
 * anyone" — came back as this directive with only the acknowledgement rewritten,
 * an agent standing still while claiming to run to the lake. Measured over three
 * runs each: with `move_target: null` the order failed 3/3; with a concrete
 * `move_target` it passed 3/3, changing nothing else. See DECISIONS.md.
 */
export function humanInitialDirective(spawn: { x: number; y: number }): Directive {
  return {
    stance: "hold_position",
    move_target: { type: "point", x: spawn.x, y: spawn.y },
    engage_range: 120,
    target_priority: "closest",
    retreat_hp: 0.25,
    retreat_to: "away_from_enemy",
    acknowledgement: "Awaiting orders.",
  };
}

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
