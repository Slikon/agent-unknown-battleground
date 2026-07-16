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
  ZONE_SAFE_MARGIN,
  clampToLand,
} from "@aub/shared";
import type { Zone } from "./Zone";
import { Pathfinder, type Point } from "./Pathfinder";

/**
 * Facing only flips when the horizontal delta exceeds this (px). Sub-pixel /
 * near-vertical movement used to flip `dir` every tick, making units look like
 * they spin.
 */
const DIR_FLIP_MIN_PX = 3;

/**
 * A committed destination is kept until the desired one drifts at least this
 * far (px). Recomputing the goal every tick lets destinations derived from
 * moving inputs (flee points, zone-clamped ring points, land-snapped water
 * targets) alternate between two spots — the unit vibrates in place. Combat
 * pursuit needs the tight value: it must stay below WARRIOR_ATTACK_RANGE so a
 * stale goal can never strand a pursuer just out of melee reach. Everything
 * else (landmark cruising, fleeing, retreating) commits coarsely: run the
 * chosen destination out before picking a new one.
 */
const PURSUIT_STICKINESS_PX = 32;
const CRUISE_STICKINESS_PX = 96;

/**
 * Flee legs are committed absolutely: a fleeing agent runs its chosen escape
 * out (a leg is at most ~200 px, well under a second) before picking a new
 * one. Its flee point is re-derived from its own position and the zone's
 * inner ring, which can swing to the other side of the agent with one step —
 * no finite stickiness threshold damps that.
 */
const FLEE_STICKINESS_PX = Number.POSITIVE_INFINITY;

/**
 * Arrival dead-zone: standing within this of the goal counts as "there".
 * Without it, a unit parked on its goal keeps re-pathing from a start tile
 * that flaps with every micro-step and runs in place. Must stay below
 * WARRIOR_ATTACK_RANGE (pursuit stops at melee reach, never inside this).
 */
const ARRIVE_RADIUS_PX = 20;

/**
 * An evasive agent only flees enemies inside this radius (px); beyond it there
 * is nothing to run from and it stands its ground.
 */
const FLEE_TRIGGER_RADIUS = 300;

/** Per-agent server-only state (never synced): its directive + movement/combat bookkeeping. */
interface AgentRuntime {
  directive: Directive;
  lastAttackMs: number;
  path: Point[];
  /** Destination the current path was computed for (goal stickiness). */
  goal: Point | null;
  /** Zone override latched on (hysteresis — see stepAgent rule 2). */
  zoneOverride: boolean;
}

/**
 * The Behavior Executor (SPEC.md §3.1) — the heart of the game loop. Each tick,
 * for every living agent, it runs that agent's directive as the fixed-priority
 * state machine from the spec. Written general-purpose over ANY directive from
 * the start; Phase 2 just happens to feed every agent the same hardcoded one.
 *
 * Priority per tick (top to bottom):
 *   1. HP below retreat_hp?            → retreat
 *   2. Zone closing in?                → run inward (latched until well inside)
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
      goal: null,
      zoneOverride: false,
    });
  }

  removeAgent(sessionId: string): void {
    this.runtime.delete(sessionId);
  }

  /** Drop all per-agent state (between matches). */
  clear(): void {
    this.runtime.clear();
  }

  setDirective(sessionId: string, directive: Directive): void {
    const rt = this.runtime.get(sessionId);
    if (rt) {
      rt.directive = directive;
      rt.path = [];
      rt.goal = null;
    }
  }

  /** Read side of `setDirective` — feeds `currentDirective` into the LLM snapshot (Phase 4). */
  getDirective(sessionId: string): Directive | undefined {
    return this.runtime.get(sessionId)?.directive;
  }

  /**
   * Advance every living agent one fixed step. Returns the sessionIds of agents
   * that died this tick (hp reached 0) so the room can remove them from state.
   * `zone`, when live, enables the hard-wired "get to safety" override.
   */
  tick(
    agents: MapSchema<AgentState>,
    nowMs: number,
    dtSec: number,
    zone: Zone | null = null,
  ): string[] {
    agents.forEach((self) => {
      if (self.hp <= 0) return; // killed earlier this same tick → skip its turn
      const rt = this.runtime.get(self.id);
      if (rt) this.stepAgent(self, agents, rt, nowMs, dtSec, zone);
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
    zone: Zone | null,
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

    // 2. Zone override (SPEC.md §3.1 rule 2) — the one instinct a directive can
    //    never disable: if we're outside the safe circle (or it's closing onto
    //    us within the margin), run inward toward safety. Latched with
    //    hysteresis: it engages near the edge but only releases once the agent
    //    is comfortably inside (zoneInnerRadius), so the directive can't shove
    //    the unit straight back across the boundary and flip-flop control every
    //    tick. While engaged it steers at the zone centre — a goal that doesn't
    //    shift with the agent's own bearing. The companion clampToZone on rules
    //    3–5 keeps directives from marching a released unit back out (retreat,
    //    rule 1, deliberately stays unclamped per the SPEC's priority order).
    if (zone) {
      const c = zone.center;
      const dist = Math.hypot(self.x - c.x, self.y - c.y);
      const engageRadius = zone.currentRadius - ZONE_SAFE_MARGIN;
      if (dist > engageRadius) rt.zoneOverride = true;
      else if (dist <= zoneInnerRadius(zone)) rt.zoneOverride = false;
      if (rt.zoneOverride) {
        this.navigate(self, rt, c, dtSec);
        return;
      }
    }

    // 3. Combat.
    if (target && directive.engage_range > 0 && stanceAttacks(directive.stance)) {
      const dist = distance(self, target);
      if (dist <= directive.engage_range) {
        if (dist <= WARRIOR_ATTACK_RANGE) {
          face(self, target);
          self.anim = "attack";
          rt.path = [];
          rt.goal = null;
          if (nowMs - rt.lastAttackMs >= WARRIOR_ATTACK_COOLDOWN_MS) {
            target.hp = Math.max(0, target.hp - WARRIOR_DAMAGE);
            rt.lastAttackMs = nowMs;
          }
          return;
        }
        // Within engage_range but not yet in melee → close the gap. Every
        // attacking stance does this; what differs between stances is their
        // move_target (a hunter chases across the map, a holder only fights what
        // enters its engage_range and then returns to its post). Pursuit beyond
        // engage_range never happens: this whole branch is gated on it.
        this.navigate(
          self,
          rt,
          clampToZone({ x: target.x, y: target.y }, zone),
          dtSec,
          PURSUIT_STICKINESS_PX,
        );
        return;
      }
    }

    // 4. Move toward the directive's target.
    const dest = resolveMoveTarget(directive.move_target, target);
    if (dest) {
      this.navigate(self, rt, clampToZone(dest, zone), dtSec);
      return;
    }

    // 5. Idle behavior per stance.
    if (directive.stance === "evasive" && target && distance(self, target) <= FLEE_TRIGGER_RADIUS) {
      this.navigate(self, rt, clampToZone(fleePoint(self, target), zone), dtSec, FLEE_STICKINESS_PX);
      return;
    }
    this.stand(self, rt);
  }

  /** Path to `dest` (sticking with the committed goal until it drifts) and step along it. */
  private navigate(
    self: AgentState,
    rt: AgentRuntime,
    dest: Point,
    dtSec: number,
    stickiness = CRUISE_STICKINESS_PX,
  ): void {
    // Never path into water/cover — snap a blocked destination to solid ground.
    dest = clampToLand(dest.x, dest.y);
    // Already standing on the goal → hold there.
    if (distance(self, rt.goal ?? dest) <= ARRIVE_RADIUS_PX) {
      this.stand(self, rt);
      return;
    }
    if (!rt.goal || distance(rt.goal, dest) >= stickiness) {
      rt.path = this.pathfinder.findPath({ x: self.x, y: self.y }, dest);
      rt.goal = dest;
    } else if (rt.path.length === 0) {
      // Path exhausted but the goal barely moved — re-path to the committed
      // goal (a no-op step once we're standing on it).
      rt.path = this.pathfinder.findPath({ x: self.x, y: self.y }, rt.goal);
    }
    const moved = this.advance(self, rt, dtSec);
    self.anim = moved ? "run" : "idle";
  }

  /** Move up to one tick's worth of distance along the waypoint list. */
  private advance(self: AgentState, rt: AgentRuntime, dtSec: number): boolean {
    let remaining = MOVE_SPEED * dtSec;
    let moved = false;
    const startX = self.x;
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
    }
    // Face where we actually went this tick, not each intermediate waypoint.
    const netDx = self.x - startX;
    if (netDx < -DIR_FLIP_MIN_PX) self.dir = "left";
    else if (netDx > DIR_FLIP_MIN_PX) self.dir = "right";
    return moved;
  }

  private stand(self: AgentState, rt: AgentRuntime): void {
    rt.path = [];
    rt.goal = null;
    self.anim = "idle";
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function face(self: AgentState, target: { x: number }): void {
  const dx = target.x - self.x;
  if (dx < -DIR_FLIP_MIN_PX) self.dir = "left";
  else if (dx > DIR_FLIP_MIN_PX) self.dir = "right";
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

/**
 * How deep inside the safe circle counts as "comfortably in": where the zone
 * override releases, and the deepest point clampToZone pulls a destination to.
 * Sharing one value means a just-released unit is already standing where its
 * clamped directive wants it — no walk-back oscillation at the edge. The
 * engage/2 floor keeps a workable hysteresis gap once the circle gets small.
 */
function zoneInnerRadius(zone: Zone): number {
  const engageRadius = zone.currentRadius - ZONE_SAFE_MARGIN;
  return Math.max(zone.currentRadius - 2 * ZONE_SAFE_MARGIN, engageRadius * 0.5);
}

/** Pull a destination outside the safe circle back onto its inner ring. */
function clampToZone(dest: Point, zone: Zone | null): Point {
  if (!zone) return dest;
  const c = zone.center;
  const dx = dest.x - c.x;
  const dy = dest.y - c.y;
  const d = Math.hypot(dx, dy);
  const max = zoneInnerRadius(zone);
  if (d <= max) return dest;
  return { x: c.x + (dx / d) * max, y: c.y + (dy / d) * max };
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
