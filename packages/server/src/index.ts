import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";

// Binds to 0.0.0.0 so other machines on the LAN can connect straight away
// (SPEC.md §10: two browser windows on localhost, a laptop over Wi-Fi).
const port = Number(process.env.PORT ?? 2567);

// Plain-JS `ws` transport (not the native uWebSockets one) — plenty for the
// MVP and dependency-light.
const gameServer = new Server({
  transport: new WebSocketTransport(),
});

// Register the match room handler. Colyseus instantiates a MatchRoom on demand
// when the first client joins "match".
gameServer.define("match", MatchRoom);

gameServer
  .listen(port, "0.0.0.0")
  .then(() => {
    console.log(`⚔️  AUB server listening on ws://0.0.0.0:${port}`);
  })
  .catch((err: unknown) => {
    console.error("Failed to start AUB server:", err);
    process.exit(1);
  });
