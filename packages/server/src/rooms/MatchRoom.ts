import { Client, Room } from "@colyseus/core";
import {
  AGENT_COLORS,
  AgentState,
  BOT_DIRECTIVES,
  COUNTDOWN_SEC,
  DEFAULT_DIRECTIVE,
  FINISHED_SEC,
  LOBBY_SEC,
  MATCH_SLOTS,
  MatchState,
  SPAWN_POINTS,
  TICK_MS,
  WARRIOR_MAX_HP,
  ZONE_DAMAGE_PER_SEC,
  type AgentColor,
  type MatchPhase,
} from "@aub/shared";
import { BehaviorExecutor } from "../game/BehaviorExecutor";
import { Zone } from "../game/Zone";

function label(color: AgentColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/** Fisher–Yates in place, returning the array for convenience. */
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One Colyseus room per match, and the whole battle-royale loop (SPEC.md §8
 * Phase 3). The server is the single source of truth: it seats 5 agents (live
 * clients + AI bots), runs the behavior executor and the shrinking zone on a
 * fixed 20 Hz timestep, decides the winner, and auto-restarts — all with zero
 * humans required. Clients only render and (Phase 4) send orders.
 *
 * Lifecycle: lobby → countdown → live → finished → lobby, forever. The room is
 * created at boot and never disposes (see `index.ts` + `autoDispose = false`),
 * so a match is always in progress for spectators to drop into.
 */
export class MatchRoom extends Room<{ state: MatchState }> {
  maxClients = MATCH_SLOTS;
  autoDispose = false;
  state = new MatchState();

  private readonly executor = new BehaviorExecutor();
  private readonly zone = new Zone();

  /** Monotonic match clock (ms) driving attack cooldowns. */
  private matchTimeMs = 0;
  /** Wall-clock carry-over so logic always advances in whole TICK_MS steps. */
  private tickAccumulatorMs = 0;
  /** Seconds elapsed in the current phase. */
  private phaseElapsedSec = 0;
  /** Monotonic counter for unique bot ids. */
  private botSeq = 0;

  onCreate(): void {
    this.enterLobby();

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
    // Seating happens at the lobby→countdown transition, so a client that joins
    // mid-match just spectates until the next one starts.
    console.log(
      `[MatchRoom ${this.roomId}] ${client.sessionId} joined (phase=${this.state.phase})`,
    );
  }

  onLeave(client: Client): void {
    const agent = this.state.agents.get(client.sessionId);
    if (agent) {
      if (this.state.phase === "live" || this.state.phase === "countdown") {
        // Hand the seat to the AI so the match still plays out (SPEC.md §8: a
        // disconnect leaves the agent as a bot running its current directive).
        agent.bot = true;
        agent.name = `${label(agent.color)} (bot)`;
      } else {
        this.state.agents.delete(client.sessionId);
        this.executor.removeAgent(client.sessionId);
      }
    }
    console.log(`[MatchRoom ${this.roomId}] ${client.sessionId} left`);
  }

  onDispose(): void {
    console.log(`[MatchRoom ${this.roomId}] disposed`);
  }

  // ── Phase machine ──────────────────────────────────────────────────────────

  private setPhase(phase: MatchPhase): void {
    this.state.phase = phase;
    this.phaseElapsedSec = 0;
  }

  private enterLobby(): void {
    // Wipe the previous match — including the zone ring, which otherwise stays
    // at the old match's tiny final circle and fogs the whole island during
    // lobby/countdown.
    this.state.agents.clear();
    this.executor.clear();
    this.zone.reset();
    this.zone.writeTo(this.state.zone);
    this.state.winnerColor = "";
    this.state.winnerName = "";
    this.state.phaseTimer = LOBBY_SEC;
    this.setPhase("lobby");
    console.log(`[MatchRoom ${this.roomId}] lobby`);
  }

  private startCountdown(): void {
    this.seatAgents();
    this.state.phaseTimer = COUNTDOWN_SEC;
    this.setPhase("countdown");
    console.log(
      `[MatchRoom ${this.roomId}] countdown — ${this.state.agents.size} agents seated`,
    );
  }

  private startLive(): void {
    this.zone.reset();
    this.zone.writeTo(this.state.zone);
    this.state.phaseTimer = 0;
    this.setPhase("live");
    console.log(`[MatchRoom ${this.roomId}] live`);
  }

  private finishMatch(): void {
    // Whoever is still standing wins (0 alive = mutual KO → nobody).
    let winner: AgentState | undefined;
    this.state.agents.forEach((a) => {
      if (a.hp > 0) winner = a;
    });
    this.state.winnerColor = winner?.color ?? "";
    this.state.winnerName = winner ? winner.name : "Nobody";
    this.state.phaseTimer = FINISHED_SEC;
    this.setPhase("finished");
    console.log(
      `[MatchRoom ${this.roomId}] finished — winner: ${this.state.winnerName || "none"}`,
    );
  }

  /** Seat exactly MATCH_SLOTS agents: connected clients first, bots fill the rest. */
  private seatAgents(): void {
    this.state.agents.clear();
    this.executor.clear();

    // A shuffled pool of bot personalities so an all-bot match isn't the same
    // scripted outcome every time (the zone's random final center adds more).
    const pool = shuffle(
      Array.from({ length: MATCH_SLOTS }, (_, i) => BOT_DIRECTIVES[i % BOT_DIRECTIVES.length]),
    );

    let slot = 0;
    const seat = (id: string, isBot: boolean): void => {
      const color = AGENT_COLORS[slot];
      const spawn = SPAWN_POINTS[slot];
      const agent = new AgentState();
      agent.id = id;
      agent.color = color;
      agent.name = isBot ? `${label(color)} (bot)` : label(color);
      agent.bot = isBot;
      agent.x = spawn.x;
      agent.y = spawn.y;
      agent.hp = WARRIOR_MAX_HP;
      this.state.agents.set(id, agent);

      const directive = isBot ? pool[slot] : DEFAULT_DIRECTIVE;
      this.executor.addAgent(id, directive);
      slot += 1;
    };

    for (const client of this.clients) {
      if (slot >= MATCH_SLOTS) break;
      seat(client.sessionId, false);
    }
    while (slot < MATCH_SLOTS) {
      seat(`bot-${++this.botSeq}`, true);
    }
  }

  // ── Simulation ───────────────────────────────────────────────────────────────

  /** One fixed simulation step. */
  private tick(dtSec: number): void {
    this.phaseElapsedSec += dtSec;

    switch (this.state.phase) {
      case "lobby":
        this.state.phaseTimer = Math.max(0, Math.ceil(LOBBY_SEC - this.phaseElapsedSec));
        if (this.phaseElapsedSec >= LOBBY_SEC) this.startCountdown();
        break;

      case "countdown":
        this.state.phaseTimer = Math.max(0, Math.ceil(COUNTDOWN_SEC - this.phaseElapsedSec));
        if (this.phaseElapsedSec >= COUNTDOWN_SEC) this.startLive();
        break;

      case "live":
        this.stepLive(dtSec);
        break;

      case "finished":
        this.state.phaseTimer = Math.max(0, Math.ceil(FINISHED_SEC - this.phaseElapsedSec));
        if (this.phaseElapsedSec >= FINISHED_SEC) this.enterLobby();
        break;
    }
  }

  private stepLive(dtSec: number): void {
    this.zone.update(dtSec);
    this.zone.writeTo(this.state.zone);

    // Out-of-zone damage (SPEC.md §6) before the executor runs.
    this.state.agents.forEach((a) => {
      if (a.hp > 0 && this.zone.isOutside(a.x, a.y)) {
        a.hp = Math.max(0, a.hp - ZONE_DAMAGE_PER_SEC * dtSec);
      }
    });

    const dead = this.executor.tick(this.state.agents, this.matchTimeMs, dtSec, this.zone);
    for (const id of dead) {
      // Removal from state triggers the death explosion + cleanup on clients.
      this.state.agents.delete(id);
      this.executor.removeAgent(id);
      console.log(`[MatchRoom ${this.roomId}] ${id} died`);
    }

    // Last one standing wins (SPEC.md §6).
    if (this.state.agents.size <= 1) this.finishMatch();
  }
}
