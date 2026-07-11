import { GRID_COLS, GRID_ROWS, TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import type { LandmarkName } from "./constants";

/**
 * Placeholder collision map. Both the server (A* pathfinding) and the client
 * (rendering the impassable tiles) read this single source of truth — the real
 * Tiny Swords island loaded from Tiled replaces it later (SPEC.md §6/§8). Kept
 * deliberately tiny: one rock cluster near the center so movement has to path
 * around something, which is all Phase 2 needs to exercise A*.
 */

export interface TileCoord {
  col: number;
  row: number;
}

function buildObstacles(): TileCoord[] {
  const tiles: TileCoord[] = [];
  // 3×3 rock cluster straddling the map center.
  for (let col = 15; col <= 17; col++) {
    for (let row = 8; row <= 10; row++) {
      tiles.push({ col, row });
    }
  }
  return tiles;
}

export const OBSTACLE_TILES: readonly TileCoord[] = buildObstacles();

const blockedKeys = new Set(OBSTACLE_TILES.map((t) => `${t.col},${t.row}`));

export function isTileBlocked(col: number, row: number): boolean {
  return blockedKeys.has(`${col},${row}`);
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

/** Center pixel of a tile. */
export function tileCenterPx(col: number, row: number): { x: number; y: number } {
  return { x: (col + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE };
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
 * Placeholder landmark coordinates within the current single-screen world.
 * The behavior executor resolves `move_target`/`retreat_to` landmarks through
 * this; real polygons come from the Tiled map in Phase 4 (SPEC.md §4/§5).
 */
export const LANDMARK_COORDS: Record<LandmarkName, { x: number; y: number }> = {
  castle: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.12 },
  forest_north: { x: WORLD_WIDTH * 0.25, y: WORLD_HEIGHT * 0.18 },
  forest_south: { x: WORLD_WIDTH * 0.25, y: WORLD_HEIGHT * 0.82 },
  lake: { x: WORLD_WIDTH * 0.1, y: WORLD_HEIGHT * 0.5 },
  gold_mine: { x: WORLD_WIDTH * 0.9, y: WORLD_HEIGHT * 0.5 },
  center: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
};
