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
}

/** Fill a tile disk of `kind` around a world-px center, skipping water. */
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
      if (Math.hypot(dc, dr) > tileRadius) continue;
      const col = center.col + dc;
      const row = center.row + dr;
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;
      if (isWater(col, row)) continue;
      out.push({ col, row, kind });
    }
  }
}

function buildObstacles(): Obstacle[] {
  const out: Obstacle[] = [];
  // Forests at the two forest landmarks.
  addBlob(out, LANDMARK_COORDS.forest_north.x, LANDMARK_COORDS.forest_north.y, 2.6, "tree");
  addBlob(out, LANDMARK_COORDS.forest_south.x, LANDMARK_COORDS.forest_south.y, 2.6, "tree");
  // A gold field at the mine.
  addBlob(out, LANDMARK_COORDS.gold_mine.x, LANDMARK_COORDS.gold_mine.y, 1.8, "gold");
  // Rock fields breaking up the interior so A* has to path around cover.
  const C = ISLAND_CENTER;
  addBlob(out, C.x + 0.22 * ISLAND_RADIUS, C.y - 0.18 * ISLAND_RADIUS, 1.6, "rock");
  addBlob(out, C.x - 0.2 * ISLAND_RADIUS, C.y + 0.12 * ISLAND_RADIUS, 1.6, "rock");
  addBlob(out, C.x + 0.05 * ISLAND_RADIUS, C.y + 0.32 * ISLAND_RADIUS, 1.4, "rock");
  addBlob(out, C.x + 0.34 * ISLAND_RADIUS, C.y + 0.34 * ISLAND_RADIUS, 1.2, "rock");
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
