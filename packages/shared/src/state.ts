import { MapSchema, Schema, type } from "@colyseus/schema";
import { WARRIOR_MAX_HP } from "./constants";
import type { AgentColor } from "./constants";

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
  /** Colyseus sessionId of the owning client (also this agent's map key). */
  @type("string") id = "";

  /** Faction color — unique per agent within a match. */
  @type("string") color: AgentColor = "blue";

  @type("number") x = 0;
  @type("number") y = 0;

  @type("string") dir: AgentDir = "right";
  @type("string") anim: AgentAnim = "idle";

  /** Current hit points. Reaches 0 → the agent dies and is removed. */
  @type("number") hp = WARRIOR_MAX_HP;
}

export class MatchState extends Schema {
  /** Keyed by client sessionId. */
  @type({ map: AgentState }) agents = new MapSchema<AgentState>();
}
