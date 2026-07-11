import { MapSchema, Schema, type } from "@colyseus/schema";
import type { AgentColor } from "./constants";

/**
 * Synchronized match state — the wire contract between the authoritative
 * server and every client (SPEC.md §3.1). The server mutates it on its fixed
 * 20 Hz tick; @colyseus/schema delta-encodes the changes to clients. The
 * client only renders it (SPEC.md §9 rule 1).
 */

/** Which way a unit's sprite faces (Tiny Swords strips face right natively). */
export type AgentDir = "left" | "right";

/** Which animation a unit is in. Attack/death arrive with Phase 2. */
export type AgentAnim = "idle" | "run";

export class AgentState extends Schema {
  /** Colyseus sessionId of the owning client (also this agent's map key). */
  @type("string") id = "";

  /** Faction color — unique per agent within a match. */
  @type("string") color: AgentColor = "blue";

  @type("number") x = 0;
  @type("number") y = 0;

  @type("string") dir: AgentDir = "right";
  @type("string") anim: AgentAnim = "idle";
}

export class MatchState extends Schema {
  /** Keyed by client sessionId. */
  @type({ map: AgentState }) agents = new MapSchema<AgentState>();
}
