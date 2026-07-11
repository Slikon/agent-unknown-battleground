import PF from "pathfinding";
import { buildGridMatrix, pxToTile, tileCenterPx } from "@aub/shared";

export interface Point {
  x: number;
  y: number;
}

/**
 * Server-side A* over the world tile grid (SPEC.md §3.1). The obstacle layout
 * comes from `@aub/shared` so client rendering and server collision never drift.
 */
export class Pathfinder {
  private readonly matrix = buildGridMatrix();
  private readonly finder = new PF.AStarFinder({
    allowDiagonal: true,
    dontCrossCorners: true,
  });

  /**
   * Waypoints (world px) from `start` to `goal`, walking around blocked tiles.
   * Excludes the start; the final waypoint is the exact goal pixel (not the
   * goal tile's center) so units meet precisely. Returns a straight-line
   * single waypoint when start and goal share a tile or no path exists.
   */
  findPath(start: Point, goal: Point): Point[] {
    const s = pxToTile(start.x, start.y);
    const g = pxToTile(goal.x, goal.y);
    if (s.col === g.col && s.row === g.row) return [{ x: goal.x, y: goal.y }];

    // findPath mutates node state, so hand it a fresh Grid each call; the source
    // matrix stays clean (the grid is tiny — 32×18 — so this is cheap).
    const grid = new PF.Grid(this.matrix);
    if (!grid.isWalkableAt(g.col, g.row)) {
      return [{ x: goal.x, y: goal.y }]; // unreachable goal → head straight at it
    }

    const tiles = this.finder.findPath(s.col, s.row, g.col, g.row, grid);
    if (tiles.length <= 1) return [{ x: goal.x, y: goal.y }];

    const points = tiles.slice(1).map(([col, row]) => tileCenterPx(col, row));
    points[points.length - 1] = { x: goal.x, y: goal.y };
    return points;
  }
}
