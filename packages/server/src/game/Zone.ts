import {
  ISLAND_CENTER,
  ISLAND_RADIUS,
  ZONE_FINAL_RADIUS,
  ZONE_PAUSE_SEC,
  ZONE_SHRINK_SEC,
  ZONE_STAGES,
  ZONE_START_RADIUS,
  type ZoneState,
  nearestWalkable,
} from "@aub/shared";

interface Ring {
  x: number;
  y: number;
  radius: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Drives the shrinking safe circle (SPEC.md §6). It plays out as a fixed number
 * of stages, each a `pause` (the circle holds) followed by a `shrink` (it eases
 * from the current ring toward the next, smaller one). The rings march from the
 * whole-island start circle toward a random final center picked per match, so
 * the closing point is never the same twice. Purely server-side; the room copies
 * the current ring into synced `ZoneState` each tick and applies out-of-zone
 * damage.
 */
export class Zone {
  private stages: Ring[] = [];
  private stageIndex = 0;
  private mode: "pause" | "shrink" = "pause";
  private timer = 0;

  private cx = ISLAND_CENTER.x;
  private cy = ISLAND_CENTER.y;
  private radius = ZONE_START_RADIUS;
  private shrinking = false;
  private nextShrinkSec = ZONE_PAUSE_SEC;

  /** Pick a fresh random final center and rebuild the stage plan. */
  reset(): void {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.4 * ISLAND_RADIUS;
    const final = nearestWalkable(
      ISLAND_CENTER.x + Math.cos(angle) * r,
      ISLAND_CENTER.y + Math.sin(angle) * r,
    );

    this.stages = [];
    for (let i = 0; i <= ZONE_STAGES; i++) {
      const t = i / ZONE_STAGES;
      this.stages.push({
        x: lerp(ISLAND_CENTER.x, final.x, t),
        y: lerp(ISLAND_CENTER.y, final.y, t),
        radius: lerp(ZONE_START_RADIUS, ZONE_FINAL_RADIUS, t),
      });
    }

    this.stageIndex = 0;
    this.mode = "pause";
    this.timer = 0;
    this.recompute();
  }

  /** Advance the timeline one fixed step. */
  update(dtSec: number): void {
    if (this.stageIndex >= ZONE_STAGES) {
      this.recompute();
      return;
    }
    this.timer += dtSec;
    if (this.mode === "pause") {
      if (this.timer >= ZONE_PAUSE_SEC) {
        this.mode = "shrink";
        this.timer = 0;
      }
    } else if (this.timer >= ZONE_SHRINK_SEC) {
      this.stageIndex += 1;
      this.mode = "pause";
      this.timer = 0;
    }
    this.recompute();
  }

  private recompute(): void {
    if (this.stageIndex >= ZONE_STAGES) {
      const last = this.stages[ZONE_STAGES];
      this.cx = last.x;
      this.cy = last.y;
      this.radius = last.radius;
      this.shrinking = false;
      this.nextShrinkSec = 0;
      return;
    }
    const from = this.stages[this.stageIndex];
    if (this.mode === "pause") {
      this.cx = from.x;
      this.cy = from.y;
      this.radius = from.radius;
      this.shrinking = false;
      this.nextShrinkSec = Math.max(0, Math.ceil(ZONE_PAUSE_SEC - this.timer));
    } else {
      const to = this.stages[this.stageIndex + 1];
      const t = Math.min(1, this.timer / ZONE_SHRINK_SEC);
      this.cx = lerp(from.x, to.x, t);
      this.cy = lerp(from.y, to.y, t);
      this.radius = lerp(from.radius, to.radius, t);
      this.shrinking = true;
      this.nextShrinkSec = 0;
    }
  }

  /** Is a world point outside the current safe circle (taking damage)? */
  isOutside(x: number, y: number): boolean {
    return Math.hypot(x - this.cx, y - this.cy) > this.radius;
  }

  get center(): { x: number; y: number } {
    return { x: this.cx, y: this.cy };
  }

  get currentRadius(): number {
    return this.radius;
  }

  get isShrinking(): boolean {
    return this.shrinking;
  }

  /** Copy the current ring into the synced state for clients. */
  writeTo(state: ZoneState): void {
    state.x = this.cx;
    state.y = this.cy;
    state.radius = this.radius;
    state.shrinking = this.shrinking;
    state.nextShrinkSec = this.nextShrinkSec;
  }
}
