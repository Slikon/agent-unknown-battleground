/**
 * Named zones on the map (defined in Tiled as objects in later phases).
 * They give the LLM a fixed vocabulary of places and let the player speak
 * naturally ("hold by the lake"). See SPEC.md §4.
 */
export const LANDMARK_NAMES = [
  "castle",
  "forest_north",
  "forest_south",
  "lake",
  "gold_mine",
  "center",
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];

/** Fixed simulation timestep (SPEC.md §9 rule 2): 20 Hz, 50 ms per tick. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/**
 * Faction colors in slot order — the Nth player to join gets AGENT_COLORS[N]
 * (SPEC.md §6: 5 agents, one color each).
 */
export const AGENT_COLORS = [
  "blue",
  "red",
  "purple",
  "yellow",
  "black",
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

/**
 * World size in px. Phase 1 placeholder: a single screen with no tilemap —
 * grows to the ~60×60-tile island (3840×3840) once the Tiled map lands.
 */
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 540;

/** Warrior movement speed, px/sec. */
export const MOVE_SPEED = 220;
