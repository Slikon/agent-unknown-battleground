import { MapSchema, Schema, type } from "@colyseus/schema";
import { WARRIOR_MAX_HP, ZONE_START_RADIUS } from "./constants";
import type { AgentColor, MatchPhase } from "./constants";
import { ISLAND_CENTER } from "./map";

/**
 * Synchronized match state — the wire contract between the authoritative
 * server and every client (SPEC.md §3.1). The server mutates it on its fixed
 * 20 Hz tick; @colyseus/schema delta-encodes the changes to clients. The
 * client only renders it (SPEC.md §9 rule 1).
 */

/** Which way a unit's sprite faces (Tiny Swords strips face right natively). */
export type AgentDir = "left" | "right";

/** Which animation a unit is in. Death is rendered client-side on removal. */
export type AgentAnim = "idle" | "run" | "attack";

export class AgentState extends Schema {
  /** Unique agent key within the match (client sessionId, or "bot-N"). */
  @type("string") id = "";

  /** Faction color — unique per agent within a match. */
  @type("string") color: AgentColor = "blue";

  /** Display name for the killfeed / winner screen (color-based until Phase 5 lobby). */
  @type("string") name = "";

  /** True for AI-filled slots (no connected client). */
  @type("boolean") bot = false;

  @type("number") x = 0;
  @type("number") y = 0;

  @type("string") dir: AgentDir = "right";
  @type("string") anim: AgentAnim = "idle";

  /** Current hit points. Reaches 0 → the agent dies and is removed. */
  @type("number") hp = WARRIOR_MAX_HP;
}

/**
 * The shrinking safe circle (SPEC.md §6). Center + radius drive the client's
 * zone ring and darkened danger area; `nextShrinkSec` feeds the mini-UI timer.
 */
export class ZoneState extends Schema {
  @type("number") x = ISLAND_CENTER.x;
  @type("number") y = ISLAND_CENTER.y;
  @type("number") radius = ZONE_START_RADIUS;

  /** True while the circle is actively closing (vs. paused between shrinks). */
  @type("boolean") shrinking = false;

  /** Seconds until the next shrink begins (0 while shrinking). */
  @type("number") nextShrinkSec = 0;
}

export class MatchState extends Schema {
  /** Keyed by agent id (client sessionId, or "bot-N"). Holds only living agents. */
  @type({ map: AgentState }) agents = new MapSchema<AgentState>();

  /** lobby → countdown → live → finished → lobby (SPEC.md §8 Phase 3). */
  @type("string") phase: MatchPhase = "lobby";

  /** Seconds left in a timed phase (countdown / finished), for the UI. */
  @type("number") phaseTimer = 0;

  @type(ZoneState) zone = new ZoneState();

  /** Winner of the finished match (empty until someone wins). */
  @type("string") winnerColor = "";
  @type("string") winnerName = "";
}
