import { Client, Room } from "@colyseus/core";
import {
  AGENT_COLORS,
  AgentState,
  MOVE_SPEED,
  MSG_MOVE,
  MatchState,
  MoveMessageSchema,
  TICK_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@aub/shared";

/**
 * Spawn slots by color index, as fractions of the world size — spread out so
 * units never spawn stacked. Same length as AGENT_COLORS by construction.
 */
const SPAWN_SLOTS = [
  { x: 0.25, y: 0.5 }, // blue
  { x: 0.75, y: 0.5 }, // red
  { x: 0.5, y: 0.25 }, // purple
  { x: 0.5, y: 0.75 }, // yellow
  { x: 0.5, y: 0.5 }, // black
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * One Colyseus room per match (SPEC.md §3.1). The server is the single source
 * of truth: clients only send orders; all movement is computed here on a fixed
 * 20 Hz timestep (SPEC.md §9 rules 1–2).
 */
export class MatchRoom extends Room<{ state: MatchState }> {
  maxClients = AGENT_COLORS.length;
  state = new MatchState();

  /** Current move order per agent. Server-only — clients never see targets. */
  private moveTargets = new Map<string, { x: number; y: number }>();

  /** Wall-clock carry-over so logic always advances in whole TICK_MS steps. */
  private tickAccumulatorMs = 0;

  onCreate(): void {
    this.onMessage(MSG_MOVE, (client, message: unknown) => {
      this.handleMove(client, message);
    });

    // Fixed timestep: the interval callback fires with real (jittery) deltas;
    // accumulate them and step the simulation in exact 50 ms ticks.
    this.setSimulationInterval((deltaMs) => {
      this.tickAccumulatorMs += deltaMs;
      while (this.tickAccumulatorMs >= TICK_MS) {
        this.tickAccumulatorMs -= TICK_MS;
        this.tick(TICK_MS / 1000);
      }
    }, TICK_MS);

    console.log(`[MatchRoom ${this.roomId}] created`);
  }

  onJoin(client: Client): void {
    const taken = new Set<string>();
    this.state.agents.forEach((agent) => taken.add(agent.color));
    // maxClients === AGENT_COLORS.length, so a free slot always exists.
    const slot = AGENT_COLORS.findIndex((color) => !taken.has(color));

    const agent = new AgentState();
    agent.id = client.sessionId;
    agent.color = AGENT_COLORS[slot];
    agent.x = Math.round(SPAWN_SLOTS[slot].x * WORLD_WIDTH);
    agent.y = Math.round(SPAWN_SLOTS[slot].y * WORLD_HEIGHT);
    this.state.agents.set(client.sessionId, agent);

    console.log(
      `[MatchRoom ${this.roomId}] ${client.sessionId} joined as ${agent.color}`,
    );
  }

  onLeave(client: Client): void {
    this.state.agents.delete(client.sessionId);
    this.moveTargets.delete(client.sessionId);
    console.log(`[MatchRoom ${this.roomId}] ${client.sessionId} left`);
  }

  onDispose(): void {
    console.log(`[MatchRoom ${this.roomId}] disposed`);
  }

  private handleMove(client: Client, message: unknown): void {
    // Untrusted input (SPEC.md §9 rule 4): silently drop malformed orders.
    const parsed = MoveMessageSchema.safeParse(message);
    if (!parsed.success) return;
    if (!this.state.agents.has(client.sessionId)) return;

    this.moveTargets.set(client.sessionId, {
      x: clamp(parsed.data.x, 0, WORLD_WIDTH),
      y: clamp(parsed.data.y, 0, WORLD_HEIGHT),
    });
  }

  /** One fixed simulation step: advance every agent toward its move target. */
  private tick(dtSec: number): void {
    this.state.agents.forEach((agent, sessionId) => {
      const target = this.moveTargets.get(sessionId);
      if (!target) return;

      const dx = target.x - agent.x;
      const dy = target.y - agent.y;
      const dist = Math.hypot(dx, dy);
      const step = MOVE_SPEED * dtSec;

      if (dist <= step) {
        agent.x = target.x;
        agent.y = target.y;
        this.moveTargets.delete(sessionId);
        agent.anim = "idle";
      } else {
        agent.x += (dx / dist) * step;
        agent.y += (dy / dist) * step;
        if (dx !== 0) agent.dir = dx < 0 ? "left" : "right";
        if (agent.anim !== "run") agent.anim = "run";
      }
    });
  }
}
