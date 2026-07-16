import type { MapSchema } from "@colyseus/schema";
import {
  type AgentSnapshot,
  type AgentState,
  type Bearing,
  type Directive,
  type EnemySnapshot,
  type LandmarkName,
  LANDMARK_COORDS,
  WARRIOR_MAX_HP,
} from "@aub/shared";

/**
 * Builds the point-in-time `AgentSnapshot` substituted into the LLM's system
 * prompt (SPEC.md §5/§8 Phase 4). Pure function of plain data — no Colyseus
 * imports beyond types — so it's trivially unit-testable and reusable by
 * `scripts/test-llm.ts` for fake snapshots without a running room.
 */
export function buildAgentSnapshot(
  self: AgentState,
  agents: MapSchema<AgentState>,
  current: Directive,
): AgentSnapshot {
  const visibleEnemies: EnemySnapshot[] = [];
  agents.forEach((a) => {
    if (a.id === self.id || a.hp <= 0) return;
    visibleEnemies.push({
      color: a.color,
      hpPercent: Math.round((100 * a.hp) / WARRIOR_MAX_HP),
      distancePx: Math.round(Math.hypot(a.x - self.x, a.y - self.y)),
      bearing: bearingOf(a.x - self.x, a.y - self.y),
    });
  });

  return {
    hpPercent: Math.round((100 * self.hp) / WARRIOR_MAX_HP),
    pos: { x: Math.round(self.x), y: Math.round(self.y) },
    nearestLandmark: nearestLandmark(self.x, self.y),
    visibleEnemies,
    currentDirective: current,
  };
}

/** Argmin over `LANDMARK_COORDS` by straight-line distance. */
function nearestLandmark(x: number, y: number): LandmarkName {
  let best: LandmarkName = "center";
  let bestDist = Infinity;
  for (const name of Object.keys(LANDMARK_COORDS) as LandmarkName[]) {
    const c = LANDMARK_COORDS[name];
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

/**
 * 8-way compass bearing from a (dx, dy) offset. Screen convention: -y is
 * "north" (up), matching `SPAWN_POINTS`' "first spawn due north" comment
 * (angle -90° → up). 0° = east, sweeping clockwise through south (+y) to west.
 */
function bearingOf(dx: number, dy: number): Bearing {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // (-180, 180], 0=east, 90=south
  const sectors: Bearing[] = [
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
    "north",
    "north-east",
  ];
  // Shift by half a sector (22.5°) so each named direction is sector-centered,
  // then bucket into one of 8 45°-wide sectors.
  const index = Math.round(deg / 45) & 7;
  return sectors[index];
}
