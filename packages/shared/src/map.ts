import {
  GRID_COLS,
  GRID_ROWS,
  MATCH_SLOTS,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants";
import type { LandmarkName } from "./constants";

/**
 * The island map — a single source of truth read by BOTH the server (A*
 * collision, spawns, zone) and the client (rendering). See SPEC.md §6/§8.
 *
 * This is still a *programmatic* stand-in for a hand-authored Tiled `.tmj`
 * island (the map phase was skipped in this repo). But unlike the Phase 2
 * placeholder — a single rock cluster on an empty screen — it is now a real
 * playable island: a round grass landmass ringed by impassable water, with a
 * lake, forests, rock fields, a castle and a gold mine at fixed landmarks. That
 * geography is what Phase 3's edge spawns and shrinking zone need, and what the
 * LLM's landmark vocabulary (Phase 4) will point at. Swapping in a Tiled map
 * later means replacing only this file's constants.
 */

export interface TileCoord {
  col: number;
  row: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

/** Center pixel of a tile. */
export function tileCenterPx(col: number, row: number): { x: number; y: number } {
  return { x: (col + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE };
}

function clampTile(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, value));
}

/** World pixel → containing tile, clamped to the grid. */
export function pxToTile(x: number, y: number): TileCoord {
  return {
    col: clampTile(Math.floor(x / TILE_SIZE), GRID_COLS),
    row: clampTile(Math.floor(y / TILE_SIZE), GRID_ROWS),
  };
}

/**
 * Deterministic per-tile hash in [0, 1). The server and the client each run
 * this module and must generate the *identical* map, so every bit of
 * "randomness" in the geography (ragged blob edges, sprite variants, jitter)
 * comes from this pure function of tile coords. Math.imul keeps each step in
 * exact int32 arithmetic, identical across JS engines.
 */
function tileHash(col: number, row: number, salt: number): number {
  let h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── Geography ────────────────────────────────────────────────────────────────

/** Island landmass: a disk centered in the world, water beyond its radius. */
export const ISLAND_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
export const ISLAND_RADIUS = 27 * TILE_SIZE; // 864 px → ~3-tile water margin

/** A freshwater lake on the west side (a hole in the landmass). */
export const LAKE: Circle = {
  x: ISLAND_CENTER.x - 0.6 * ISLAND_RADIUS,
  y: ISLAND_CENTER.y,
  radius: 5 * TILE_SIZE,
};

/**
 * Named landmark coordinates on the island (SPEC.md §4). The behavior executor
 * resolves `move_target`/`retreat_to` landmarks through this; the LLM gets these
 * names as its place vocabulary in Phase 4.
 */
export const LANDMARK_COORDS: Record<LandmarkName, { x: number; y: number }> = {
  center: { x: ISLAND_CENTER.x, y: ISLAND_CENTER.y },
  castle: { x: ISLAND_CENTER.x, y: ISLAND_CENTER.y - 0.55 * ISLAND_RADIUS },
  forest_north: {
    x: ISLAND_CENTER.x - 0.42 * ISLAND_RADIUS,
    y: ISLAND_CENTER.y - 0.42 * ISLAND_RADIUS,
  },
  forest_south: {
    x: ISLAND_CENTER.x - 0.42 * ISLAND_RADIUS,
    y: ISLAND_CENTER.y + 0.42 * ISLAND_RADIUS,
  },
  lake: { x: LAKE.x, y: LAKE.y },
  gold_mine: { x: ISLAND_CENTER.x + 0.58 * ISLAND_RADIUS, y: ISLAND_CENTER.y },
};

/** Castle sprite footprint, centered on the castle landmark. Impassable cover. */
export const CASTLE_FOOTPRINT = { cols: 3, rows: 2 };

function distToIslandCenter(x: number, y: number): number {
  return Math.hypot(x - ISLAND_CENTER.x, y - ISLAND_CENTER.y);
}

/** True where the tile is sea or lake — impassable and rendered as water. */
export function isWater(col: number, row: number): boolean {
  const { x, y } = tileCenterPx(col, row);
  if (distToIslandCenter(x, y) > ISLAND_RADIUS) return true;
  if (Math.hypot(x - LAKE.x, y - LAKE.y) <= LAKE.radius) return true;
  return false;
}

// ── Obstacles (impassable decorations placed on land) ────────────────────────

export type ObstacleKind = "tree" | "rock" | "gold";

export interface Obstacle extends TileCoord {
  kind: ObstacleKind;
  /** Art variant (0–3): the client draws the Nth sprite of the kind. */
  variant: number;
  /** Render-only pixel offset within the tile, breaking the grid-pattern look. */
  jitterX: number;
  jitterY: number;
  /** Render-only sprite size multiplier (~0.85–1.2). */
  sizeMul: number;
}

/** The render-only cosmetic fields, derived from the tile hash. */
function cosmetics(col: number, row: number): Omit<Obstacle, "col" | "row" | "kind"> {
  return {
    variant: Math.floor(tileHash(col, row, 2) * 4),
    jitterX: Math.round((tileHash(col, row, 3) - 0.5) * 14),
    jitterY: Math.round((tileHash(col, row, 4) - 0.5) * 14),
    sizeMul: 0.85 + 0.35 * tileHash(col, row, 5),
  };
}

/**
 * Fill a tile disk of `kind` around a world-px center, skipping water. The fill
 * is certain at the core but increasingly sparse toward the rim, so blobs get
 * ragged, organic edges instead of reading as filled grid disks.
 */
function addBlob(
  out: Obstacle[],
  cx: number,
  cy: number,
  tileRadius: number,
  kind: ObstacleKind,
): void {
  const center = pxToTile(cx, cy);
  const r = Math.ceil(tileRadius);
  for (let dc = -r; dc <= r; dc++) {
    for (let dr = -r; dr <= r; dr++) {
      const d = Math.hypot(dc, dr);
      if (d > tileRadius) continue;
      const col = center.col + dc;
      const row = center.row + dr;
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;
      if (isWater(col, row)) continue;
      // Gold stays a dense deliberate field (the mine); jitter alone breaks its
      // grid look. Everything else thins toward the rim for organic edges.
      if (kind !== "gold" && tileHash(col, row, 1) > 1.05 - 0.6 * (d / tileRadius)) continue;
      out.push({ col, row, kind, ...cosmetics(col, row) });
    }
  }
}

function buildObstacles(): Obstacle[] {
  const out: Obstacle[] = [];
  // Forests at the two forest landmarks (radii sized for the sparse fill).
  addBlob(out, LANDMARK_COORDS.forest_north.x, LANDMARK_COORDS.forest_north.y, 3.0, "tree");
  addBlob(out, LANDMARK_COORDS.forest_south.x, LANDMARK_COORDS.forest_south.y, 3.0, "tree");
  // A gold field at the mine.
  addBlob(out, LANDMARK_COORDS.gold_mine.x, LANDMARK_COORDS.gold_mine.y, 2.0, "gold");
  // Rock fields breaking up the interior so A* has to path around cover, plus
  // a small tree stand NE and rocks SW of the lake to break the blob symmetry.
  const C = ISLAND_CENTER;
  addBlob(out, C.x + 0.22 * ISLAND_RADIUS, C.y - 0.18 * ISLAND_RADIUS, 1.8, "rock");
  addBlob(out, C.x - 0.2 * ISLAND_RADIUS, C.y + 0.12 * ISLAND_RADIUS, 1.8, "rock");
  addBlob(out, C.x + 0.05 * ISLAND_RADIUS, C.y + 0.32 * ISLAND_RADIUS, 1.5, "rock");
  addBlob(out, C.x + 0.34 * ISLAND_RADIUS, C.y + 0.34 * ISLAND_RADIUS, 1.3, "rock");
  addBlob(out, C.x + 0.35 * ISLAND_RADIUS, C.y - 0.45 * ISLAND_RADIUS, 1.7, "tree");
  addBlob(out, C.x - 0.45 * ISLAND_RADIUS, C.y + 0.38 * ISLAND_RADIUS, 1.4, "rock");
  // De-dup tiles that overlap between blobs (first kind wins).
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = `${o.col},${o.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const OBSTACLE_TILES: readonly Obstacle[] = buildObstacles();

// Blocked set = water is implicit (isWater), plus obstacle tiles and the castle
// footprint. Kept as a Set for O(1) collision lookups.
const blockedKeys = new Set<string>();
for (const o of OBSTACLE_TILES) blockedKeys.add(`${o.col},${o.row}`);
{
  const c = pxToTile(LANDMARK_COORDS.castle.x, LANDMARK_COORDS.castle.y);
  const halfCols = Math.floor((CASTLE_FOOTPRINT.cols - 1) / 2);
  for (let dc = -halfCols; dc <= CASTLE_FOOTPRINT.cols - 1 - halfCols; dc++) {
    for (let dr = 0; dr < CASTLE_FOOTPRINT.rows; dr++) {
      blockedKeys.add(`${c.col + dc},${c.row + dr}`);
    }
  }
}

export function isTileBlocked(col: number, row: number): boolean {
  return isWater(col, row) || blockedKeys.has(`${col},${row}`);
}

// ── Decor (render-only, walkable) ────────────────────────────────────────────

/** A purely cosmetic map decoration — never blocks movement or pathfinding. */
export interface Decor extends TileCoord {
  variant: number;
  jitterX: number;
  jitterY: number;
  sizeMul: number;
}

/** Bushes scattered over open grass (render-only; units walk through them). */
function buildBushes(): Decor[] {
  const out: Decor[] = [];
  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      if (isTileBlocked(col, row)) continue;
      const { x, y } = tileCenterPx(col, row);
      if (distToIslandCenter(x, y) > ISLAND_RADIUS - 2 * TILE_SIZE) continue;
      if (tileHash(col, row, 6) < 0.012) out.push({ col, row, ...cosmetics(col, row) });
    }
  }
  return out;
}

/** Bobbing rock clusters out at sea (and occasionally in the lake). */
function buildWaterRocks(): Decor[] {
  const out: Decor[] = [];
  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      if (!isWater(col, row)) continue;
      const { x, y } = tileCenterPx(col, row);
      const sea = distToIslandCenter(x, y) > ISLAND_RADIUS + 1.5 * TILE_SIZE;
      const lake = Math.hypot(x - LAKE.x, y - LAKE.y) < LAKE.radius - TILE_SIZE;
      if (!sea && !lake) continue; // keep the coastline foam zone clear
      if (tileHash(col, row, 7) < 0.008) out.push({ col, row, ...cosmetics(col, row) });
    }
  }
  return out;
}

export const BUSH_TILES: readonly Decor[] = buildBushes();
export const WATER_ROCK_TILES: readonly Decor[] = buildWaterRocks();

/**
 * Row-major walkability matrix for PathFinding.js `new PF.Grid(matrix)`:
 * 0 = walkable, 1 = blocked.
 */
export function buildGridMatrix(): number[][] {
  const matrix: number[][] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    const line: number[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      line.push(isTileBlocked(col, row) ? 1 : 0);
    }
    matrix.push(line);
  }
  return matrix;
}

/**
 * Nearest walkable tile center to a world point, by expanding Chebyshev rings.
 * Used to keep spawns, landmark targets and flee points on solid, unblocked
 * ground instead of in the sea or inside a rock.
 */
export function nearestWalkable(x: number, y: number): { x: number; y: number } {
  const start = pxToTile(x, y);
  if (!isTileBlocked(start.col, start.row)) return tileCenterPx(start.col, start.row);
  for (let ring = 1; ring < Math.max(GRID_COLS, GRID_ROWS); ring++) {
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue; // ring perimeter only
        const col = start.col + dc;
        const row = start.row + dr;
        if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;
        if (!isTileBlocked(col, row)) return tileCenterPx(col, row);
      }
    }
  }
  return { x: ISLAND_CENTER.x, y: ISLAND_CENTER.y }; // unreachable in practice
}

/**
 * Snap a world point to walkable ground only if it isn't already — unlike
 * `nearestWalkable`, a valid point is returned unchanged (full precision), so
 * chasing an enemy's exact position stays exact while a target that lands in
 * water or a rock gets pulled to the nearest solid tile.
 */
export function clampToLand(x: number, y: number): { x: number; y: number } {
  const t = pxToTile(x, y);
  return isTileBlocked(t.col, t.row) ? nearestWalkable(x, y) : { x, y };
}

// ── Spawns ───────────────────────────────────────────────────────────────────

/**
 * Five spawn points evenly spaced on a ring near the island's edge (SPEC.md §8
 * Phase 3: "spawn 5 agents around the map's edge"), each snapped to the nearest
 * walkable tile so nobody starts in water or inside cover.
 */
function buildSpawnPoints(): { x: number; y: number }[] {
  const ringRadius = 0.8 * ISLAND_RADIUS;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < MATCH_SLOTS; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / MATCH_SLOTS; // first spawn due north
    const x = ISLAND_CENTER.x + Math.cos(angle) * ringRadius;
    const y = ISLAND_CENTER.y + Math.sin(angle) * ringRadius;
    points.push(nearestWalkable(x, y));
  }
  return points;
}

export const SPAWN_POINTS: readonly { x: number; y: number }[] = buildSpawnPoints();
