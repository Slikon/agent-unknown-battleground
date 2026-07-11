import { Client, Room } from "@colyseus/core";
import {
  AGENT_COLORS,
  AgentState,
  DEFAULT_DIRECTIVE,
  MatchState,
  TICK_MS,
  WARRIOR_MAX_HP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@aub/shared";
import { BehaviorExecutor } from "../game/BehaviorExecutor";

/**
 * Spawn slots by color index, as fractions of the world size. Kept clear of the
 * center rock cluster (see `OBSTACLE_TILES`); proper edge spawns arrive with the
 * battle-royale loop in Phase 3.
 */
const SPAWN_SLOTS = [
  { x: 0.2, y: 0.5 }, // blue
  { x: 0.8, y: 0.5 }, // red
  { x: 0.5, y: 0.15 }, // purple
  { x: 0.5, y: 0.85 }, // yellow
  { x: 0.85, y: 0.85 }, // black
] as const;

/**
 * One Colyseus room per match (SPEC.md §3.1). The server is the single source of
 * truth: it runs the behavior executor over every agent on a fixed 20 Hz
 * timestep (SPEC.md §9 rules 1–2). Clients only render and, later, send orders.
 */
export class MatchRoom extends Room<{ state: MatchState }> {
  maxClients = AGENT_COLORS.length;
  state = new MatchState();

  private readonly executor = new BehaviorExecutor();

  /** Monotonic match clock (ms) driving attack cooldowns. */
  private matchTimeMs = 0;

  /** Wall-clock carry-over so logic always advances in whole TICK_MS steps. */
  private tickAccumulatorMs = 0;

  onCreate(): void {
    // Fixed timestep: the interval fires with real (jittery) deltas; accumulate
    // them and step the simulation in exact 50 ms ticks.
    this.setSimulationInterval((deltaMs) => {
      this.tickAccumulatorMs += deltaMs;
      while (this.tickAccumulatorMs >= TICK_MS) {
        this.tickAccumulatorMs -= TICK_MS;
        this.matchTimeMs += TICK_MS;
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
    agent.hp = WARRIOR_MAX_HP;
    this.state.agents.set(client.sessionId, agent);

    // Every agent runs the same hardcoded directive in Phase 2; Phase 4 swaps in
    // LLM-produced directives per agent.
    this.executor.addAgent(client.sessionId, DEFAULT_DIRECTIVE);

    console.log(
      `[MatchRoom ${this.roomId}] ${client.sessionId} joined as ${agent.color}`,
    );
  }

  onLeave(client: Client): void {
    this.state.agents.delete(client.sessionId);
    this.executor.removeAgent(client.sessionId);
    console.log(`[MatchRoom ${this.roomId}] ${client.sessionId} left`);
  }

  onDispose(): void {
    console.log(`[MatchRoom ${this.roomId}] disposed`);
  }

  /** One fixed simulation step. */
  private tick(dtSec: number): void {
    const dead = this.executor.tick(this.state.agents, this.matchTimeMs, dtSec);
    for (const id of dead) {
      // Removal from state triggers the death explosion + cleanup on clients.
      this.state.agents.delete(id);
      this.executor.removeAgent(id);
      console.log(`[MatchRoom ${this.roomId}] ${id} died`);
    }
  }
}
