import { Client, Room } from "@colyseus/core";

/**
 * One Colyseus room per match (SPEC.md §3.1).
 *
 * Phase 0: the room is registered and boots empty — no state schema, no game
 * loop, no behavior executor yet. Those (the 20 Hz fixed-timestep tick, the
 * @colyseus/schema state, players/projectiles/zone) arrive from Phase 1 on.
 * For now it just logs its lifecycle so the server is observable.
 */
export class MatchRoom extends Room {
  onCreate(options: unknown): void {
    console.log(`[MatchRoom ${this.roomId}] created`, options ?? "");
  }

  onJoin(client: Client): void {
    console.log(`[MatchRoom ${this.roomId}] ${client.sessionId} joined`);
  }

  onLeave(client: Client): void {
    console.log(`[MatchRoom ${this.roomId}] ${client.sessionId} left`);
  }

  onDispose(): void {
    console.log(`[MatchRoom ${this.roomId}] disposed`);
  }
}
