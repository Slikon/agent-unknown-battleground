/**
 * Headless dev harness: runs the real Zone + BehaviorExecutor at 20 Hz with the
 * 5 bot personalities (no network, no rendering) and reports per-match duration,
 * the winner-personality spread, and the two Phase-3 jitter-bug metrics:
 *   1. boundary flip-flops — an agent crossing the override-engage radius
 *      back and forth ("vibrating"),
 *   2. facing-flip rate — `dir` changes per second ("spinning").
 * Use it to sanity-check behavior/pacing changes without watching real matches.
 * Run: pnpm --filter @aub/server exec tsx scripts/sim-verify.ts [matches]
 */
import { MapSchema } from "@colyseus/schema";
import {
  AgentState,
  BOT_DIRECTIVES,
  SPAWN_POINTS,
  TICK_MS,
  WARRIOR_MAX_HP,
  ZONE_DAMAGE_PER_SEC,
  ZONE_SAFE_MARGIN,
} from "@aub/shared";
import { BehaviorExecutor } from "../src/game/BehaviorExecutor";
import { Zone } from "../src/game/Zone";

const MATCHES = Number(process.argv[2] ?? 10);
const MAX_SIM_SEC = 300;
const dt = TICK_MS / 1000;

interface Stats {
  dirFlips: number;
  boundaryCrossings: number; // engage-radius sign changes while near the edge
  aliveTicks: number;
}

let totalMatches = 0;
let winners: string[] = [];
let matchDurations: number[] = [];
let worstFlipRate = 0;
let worstCrossings = 0;

for (let m = 0; m < MATCHES; m++) {
  const agents = new MapSchema<AgentState>();
  const executor = new BehaviorExecutor();
  const zone = new Zone();
  zone.reset();

  const stats = new Map<string, Stats>();
  const lastDir = new Map<string, string>();
  const lastOutside = new Map<string, boolean>();

  // Seat the 5 personalities exactly like MatchRoom (shuffled seats).
  const order = [...BOT_DIRECTIVES.keys()].sort(() => Math.random() - 0.5);
  order.forEach((dirIdx, slot) => {
    const a = new AgentState();
    a.id = `bot-${slot}-p${dirIdx}`;
    a.x = SPAWN_POINTS[slot].x;
    a.y = SPAWN_POINTS[slot].y;
    a.hp = WARRIOR_MAX_HP;
    agents.set(a.id, a);
    executor.addAgent(a.id, BOT_DIRECTIVES[dirIdx]);
    stats.set(a.id, { dirFlips: 0, boundaryCrossings: 0, aliveTicks: 0 });
    lastDir.set(a.id, a.dir);
    lastOutside.set(a.id, false);
  });

  let simSec = 0;
  let nowMs = 0;
  while (simSec < MAX_SIM_SEC && agents.size > 1) {
    simSec += dt;
    nowMs += TICK_MS;
    zone.update(dt);
    agents.forEach((a) => {
      if (a.hp > 0 && zone.isOutside(a.x, a.y)) {
        a.hp = Math.max(0, a.hp - ZONE_DAMAGE_PER_SEC * dt);
      }
    });
    const dead = executor.tick(agents, nowMs, dt, zone);
    for (const id of dead) {
      agents.delete(id);
      executor.removeAgent(id);
    }

    agents.forEach((a) => {
      const s = stats.get(a.id)!;
      s.aliveTicks++;
      if (a.dir !== lastDir.get(a.id)) {
        s.dirFlips++;
        lastDir.set(a.id, a.dir);
        if (s.dirFlips % 20 === 10) {
          const c = zone.center;
          const dist = Math.hypot(a.x - c.x, a.y - c.y);
          let nearest = Infinity;
          agents.forEach((b) => {
            if (b.id !== a.id) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
          });
          console.log(
            `  [flip] t=${simSec.toFixed(1)}s ${a.id} anim=${a.anim} pos=(${a.x.toFixed(0)},${a.y.toFixed(0)}) distC=${dist.toFixed(0)} r=${zone.currentRadius.toFixed(0)} nearestEnemy=${nearest.toFixed(0)} flips=${s.dirFlips}`,
          );
        }
      }
      const c = zone.center;
      const dist = Math.hypot(a.x - c.x, a.y - c.y);
      const outside = dist > zone.currentRadius - ZONE_SAFE_MARGIN;
      if (outside !== lastOutside.get(a.id)) {
        s.boundaryCrossings++;
        lastOutside.set(a.id, outside);
      }
    });
  }

  totalMatches++;
  matchDurations.push(simSec);
  let winner = "draw/timeout";
  agents.forEach((a) => (winner = a.id));
  if (agents.size === 1) winners.push(winner.split("-p")[1] ?? winner);

  stats.forEach((s, id) => {
    const secs = s.aliveTicks * dt;
    if (secs < 5) return;
    const flipRate = s.dirFlips / secs;
    if (flipRate > worstFlipRate) worstFlipRate = flipRate;
    if (s.boundaryCrossings > worstCrossings) worstCrossings = s.boundaryCrossings;
  });

  console.log(
    `match ${m + 1}: ${simSec.toFixed(0)}s, winner personality=${
      agents.size === 1 ? winners[winners.length - 1] : "none (timeout/draw)"
    }`,
  );
}

const avg = matchDurations.reduce((a, b) => a + b, 0) / matchDurations.length;
console.log(`\n=== ${totalMatches} matches ===`);
console.log(`avg duration: ${avg.toFixed(1)}s (min ${Math.min(...matchDurations).toFixed(0)}, max ${Math.max(...matchDurations).toFixed(0)})`);
console.log(`worst facing-flip rate: ${worstFlipRate.toFixed(2)} flips/sec (spin bug = several/sec sustained)`);
console.log(`worst boundary crossings by one agent: ${worstCrossings} (jitter bug = hundreds)`);
console.log(`winner personality histogram (0=hunter 1=castle 2=gold 3=lake 4=coward):`);
const hist: Record<string, number> = {};
for (const w of winners) hist[w] = (hist[w] ?? 0) + 1;
console.log(hist, `timeouts/draws: ${totalMatches - winners.length}`);
