import type { MapSchema } from "@colyseus/schema";
import {
  type AgentState,
  type Directive,
  LANDMARK_COORDS,
  MOVE_SPEED,
  WARRIOR_ATTACK_COOLDOWN_MS,
  WARRIOR_ATTACK_RANGE,
  WARRIOR_DAMAGE,
  WARRIOR_MAX_HP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  pxToTile,
} from "@aub/shared";
import { Pathfinder, type Point } from "./Pathfinder";

/** Per-agent server-only state (never synced): its directive + movement/combat bookkeeping. */
interface AgentRuntime {
  directive: Directive;
  lastAttackMs: number;
  path: Point[];
  /** Tile key the current path targets; recompute when the goal tile changes. */
  goalKey: string | null;
}

/**
 * The Behavior Executor (SPEC.md §3.1) — the heart of the game loop. Each tick,
 * for every living agent, it runs that agent's directive as the fixed-priority
 * state machine from the spec. Written general-purpose over ANY directive from
 * the start; Phase 2 just happens to feed every agent the same hardcoded one.
 *
 * Priority per tick (top to bottom):
 *   1. HP below retreat_hp?            → retreat
 *   2. Zone closing in?                → (skipped: no zone until Phase 3)
 *   3. Enemy in engage_range + stance
 *      allows attacking?               → combat (close in / attack)
 *   4. Has a move_target?              → move (A* to it)
 *   5. Otherwise                       → idle per stance
 */
export class BehaviorExecutor {
  private readonly pathfinder = new Pathfinder();
  private readonly runtime = new Map<string, AgentRuntime>();

  addAgent(sessionId: string, directive: Directive): void {
    this.runtime.set(sessionId, {
      directive,
      lastAttackMs: 0,
      path: [],
      goalKey: null,
    });
  }

  removeAgent(sessionId: string): void {
    this.runtime.delete(sessionId);
  }

  setDirective(sessionId: string, directive: Directive): void {
    const rt = this.runtime.get(sessionId);
    if (rt) {
      rt.directive = directive;
      rt.path = [];
      rt.goalKey = null;
    }
  }

  /**
   * Advance every living agent one fixed step. Returns the sessionIds of agents
   * that died this tick (hp reached 0) so the room can remove them from state.
   */
  tick(agents: MapSchema<AgentState>, nowMs: number, dtSec: number): string[] {
    agents.forEach((self) => {
      if (self.hp <= 0) return; // killed earlier this same tick → skip its turn
      const rt = this.runtime.get(self.id);
      if (rt) this.stepAgent(self, agents, rt, nowMs, dtSec);
    });

    const dead: string[] = [];
    agents.forEach((agent, id) => {
      if (agent.hp <= 0) dead.push(id);
    });
    return dead;
  }

  private stepAgent(
    self: AgentState,
    agents: MapSchema<AgentState>,
    rt: AgentRuntime,
    nowMs: number,
    dtSec: number,
  ): void {
    const directive = rt.directive;
    const enemies: AgentState[] = [];
    agents.forEach((a) => {
      if (a.id !== self.id && a.hp > 0) enemies.push(a);
    });
    const target = selectTarget(self, enemies, directive.target_priority);

    // 1. Retreat when hurt.
    if (directive.retreat_hp > 0 && self.hp <= directive.retreat_hp * WARRIOR_MAX_HP) {
      const dest = retreatDest(directive.retreat_to, self, target);
      if (dest) this.navigate(self, rt, dest, dtSec);
      else this.stand(self, rt);
      return;
    }

    // 2. Zone override — no zone in Phase 2.

    // 3. Combat.
    if (target && directive.engage_range > 0 && stanceAttacks(directive.stance)) {
      const dist = distance(self, target);
      if (dist <= directive.engage_range) {
        if (dist <= WARRIOR_ATTACK_RANGE) {
          face(self, target);
          self.anim = "attack";
          rt.path = [];
          rt.goalKey = null;
          if (nowMs - rt.lastAttackMs >= WARRIOR_ATTACK_COOLDOWN_MS) {
            target.hp = Math.max(0, target.hp - WARRIOR_DAMAGE);
            rt.lastAttackMs = nowMs;
          }
          return;
        }
        if (stanceChases(directive.stance)) {
          this.navigate(self, rt, { x: target.x, y: target.y }, dtSec);
          return;
        }
        // In range but this stance holds ground and isn't in melee yet → wait.
        this.stand(self, rt);
        return;
      }
    }

    // 4. Move toward the directive's target.
    const dest = resolveMoveTarget(directive.move_target, target);
    if (dest) {
      this.navigate(self, rt, dest, dtSec);
      return;
    }

    // 5. Idle behavior per stance.
    if (directive.stance === "evasive" && target) {
      this.navigate(self, rt, fleePoint(self, target), dtSec);
      return;
    }
    this.stand(self, rt);
  }

  /** Path to `dest` (recomputing only when its tile changes) and step along it. */
  private navigate(self: AgentState, rt: AgentRuntime, dest: Point, dtSec: number): void {
    const goalTile = pxToTile(dest.x, dest.y);
    const goalKey = `${goalTile.col},${goalTile.row}`;
    if (goalKey !== rt.goalKey || rt.path.length === 0) {
      rt.path = this.pathfinder.findPath({ x: self.x, y: self.y }, dest);
      rt.goalKey = goalKey;
    }
    const moved = this.advance(self, rt, dtSec);
    self.anim = moved ? "run" : "idle";
  }

  /** Move up to one tick's worth of distance along the waypoint list. */
  private advance(self: AgentState, rt: AgentRuntime, dtSec: number): boolean {
    let remaining = MOVE_SPEED * dtSec;
    let moved = false;
    while (remaining > 1e-6 && rt.path.length > 0) {
      const wp = rt.path[0];
      const dx = wp.x - self.x;
      const dy = wp.y - self.y;
      const d = Math.hypot(dx, dy);
      if (d <= remaining) {
        self.x = wp.x;
        self.y = wp.y;
        remaining -= d;
        rt.path.shift();
        moved = moved || d > 1e-6;
      } else {
        self.x += (dx / d) * remaining;
        self.y += (dy / d) * remaining;
        remaining = 0;
        moved = true;
      }
      if (dx < -1e-6) self.dir = "left";
      else if (dx > 1e-6) self.dir = "right";
    }
    return moved;
  }

  private stand(self: AgentState, rt: AgentRuntime): void {
    rt.path = [];
    rt.goalKey = null;
    self.anim = "idle";
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function face(self: AgentState, target: { x: number }): void {
  if (target.x < self.x) self.dir = "left";
  else if (target.x > self.x) self.dir = "right";
}

function selectTarget(
  self: AgentState,
  enemies: AgentState[],
  priority: Directive["target_priority"],
): AgentState | null {
  if (priority === "ignore" || enemies.length === 0) return null;
  let best = enemies[0];
  for (const e of enemies) {
    if (priority === "closest" && distance(self, e) < distance(self, best)) best = e;
    else if (priority === "weakest" && e.hp < best.hp) best = e;
    else if (priority === "strongest" && e.hp > best.hp) best = e;
  }
  return best;
}

function resolveMoveTarget(
  moveTarget: Directive["move_target"],
  target: AgentState | null,
): Point | null {
  if (!moveTarget) return null;
  switch (moveTarget.type) {
    case "point":
      return { x: moveTarget.x, y: moveTarget.y };
    case "landmark":
      return LANDMARK_COORDS[moveTarget.name];
    case "nearest_enemy":
      return target ? { x: target.x, y: target.y } : null;
  }
}

function retreatDest(
  retreatTo: Directive["retreat_to"],
  self: AgentState,
  target: AgentState | null,
): Point | null {
  if (retreatTo === "away_from_enemy") return target ? fleePoint(self, target) : null;
  return LANDMARK_COORDS[retreatTo];
}

function fleePoint(self: AgentState, target: { x: number; y: number }): Point {
  const dx = self.x - target.x;
  const dy = self.y - target.y;
  const d = Math.hypot(dx, dy) || 1;
  const flee = 200;
  return {
    x: Math.max(0, Math.min(WORLD_WIDTH, self.x + (dx / d) * flee)),
    y: Math.max(0, Math.min(WORLD_HEIGHT, self.y + (dy / d) * flee)),
  };
}

function stanceAttacks(stance: Directive["stance"]): boolean {
  return stance !== "evasive";
}

function stanceChases(stance: Directive["stance"]): boolean {
  return stance === "aggressive" || stance === "defensive";
}
