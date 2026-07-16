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
 * Faction colors in slot order — the Nth agent seated gets AGENT_COLORS[N]
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

/** Every match seats exactly this many agents (SPEC.md §6). */
export const MATCH_SLOTS = AGENT_COLORS.length;

/**
 * World size in px. Phase 3 gives it real geography: a single island centered
 * in a square world with water around the edges (SPEC.md §6). This is still a
 * *programmatic* stand-in for a hand-authored Tiled island — the geometry lives
 * in `map.ts`, a single source of truth for both server collision and client
 * rendering.
 *
 * 60×60 tiles at 32 px = 1920×1920, matching the spec's "~60×60" grid. The whole
 * world is scaled to fit the browser (no scrolling camera in the MVP), so a
 * spectator sees the entire island and every agent at once.
 */
export const TILE_SIZE = 32;
export const GRID_COLS = 60;
export const GRID_ROWS = 60;
export const WORLD_WIDTH = GRID_COLS * TILE_SIZE; // 1920
export const WORLD_HEIGHT = GRID_ROWS * TILE_SIZE; // 1920

/** Warrior movement speed, px/sec (tuned up for the larger world). */
export const MOVE_SPEED = 300;

/**
 * Warrior combat stats (SPEC.md §6): 100 HP, 15 damage per hit on a 0.8 s
 * cooldown, 40 px melee reach.
 */
export const WARRIOR_MAX_HP = 100;
export const WARRIOR_DAMAGE = 15;
export const WARRIOR_ATTACK_COOLDOWN_MS = 800;
export const WARRIOR_ATTACK_RANGE = 40;

/**
 * The shrinking play-area zone (SPEC.md §6). A circle that starts covering the
 * whole island and closes in over several stages toward a random final center;
 * standing outside it costs HP.
 *
 * The spec's 30 s pause / 20 s shrink assume cautious play; the Phase 3 bots
 * brawl faster, so the cycle is compressed — but less than it once was: with
 * camper engage ranges tuned down (see BOT_DIRECTIVES) matches survive long
 * enough for a 15 s pause / 12 s shrink cycle. Full close in ~2.7 min, inside
 * the spec's 3–5 min target, and the zone decides roughly a third of deaths.
 */
export const ZONE_STAGES = 6;
export const ZONE_PAUSE_SEC = 15; // hold before each shrink
export const ZONE_SHRINK_SEC = 12; // smooth shrink duration
/** Start radius — large enough to enclose the entire island. */
export const ZONE_START_RADIUS = 1000;
/** Final (fully-closed) radius. */
export const ZONE_FINAL_RADIUS = 130;
/**
 * Sudden death: after the last stage the circle keeps collapsing at this rate
 * (px/s) until nothing is left. Without it two passive survivors standing
 * farther apart than their engage ranges inside the final circle would stand
 * off forever and the match would never end.
 */
export const ZONE_COLLAPSE_PX_PER_SEC = 6;
/** HP drained per second while outside the safe circle. */
export const ZONE_DAMAGE_PER_SEC = 5;
/**
 * The behavior executor treats an agent within this margin of the edge as
 * "the zone is closing on me" and overrides its directive to move inward, so
 * units flee the boundary a little early instead of eating damage (SPEC.md §3.1
 * rule 2).
 */
export const ZONE_SAFE_MARGIN = 60;

/**
 * Match lifecycle timings (SPEC.md §8 Phase 3). A room cycles
 * lobby → countdown → live → finished → lobby forever.
 */
export const LOBBY_SEC = 4; // grace for humans to connect before seating
export const COUNTDOWN_SEC = 3; // agents spawned but frozen
export const FINISHED_SEC = 10; // winner screen before auto-restart

/** Match phase, synced to clients for the mini-UI (SPEC.md §8 Phase 3). */
export const MATCH_PHASES = ["lobby", "countdown", "live", "finished"] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];
