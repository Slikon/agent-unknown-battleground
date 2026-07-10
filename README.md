# Agent Unknown's Battlegrounds (AUB)

A top-down pixel-art battle royale where you don't steer a character — you give
your **agent** orders in natural language. A local LLM compiles each order into
a structured JSON *directive*, and a deterministic 20 Hz game server executes it.
The model is the commander, not the muscles: it's called only when you issue an
order, never inside the game loop.

The full design lives in [`SPEC.md`](./SPEC.md). This README covers running the
project. **Current status: Phase 0 — skeleton** (monorepo, empty Phaser scene,
empty Colyseus server). No game logic yet.

## Stack

| Layer  | Tech |
|--------|------|
| Client | Phaser 3 + Vite + TypeScript (`packages/client`) |
| Server | Node + Colyseus + TypeScript (`packages/server`) |
| Shared | Directive Zod schema, types, constants (`packages/shared`) |
| LLM    | Ollama (local) — wired up in Phase 4, not required before then |

## Prerequisites

- **Node.js ≥ 20.19** (developed on v26). Check with `node --version`.
- **pnpm ≥ 9** — the package manager for this workspace. If you don't have it:
  ```bash
  npm install -g pnpm
  ```

## Run it from scratch

```bash
# 1. Clone, then from the repo root install all workspace dependencies:
pnpm install

# 2. Start client + server together (two labelled processes, one terminal):
pnpm dev
```

Then open the client in a browser:

- **http://localhost:5173** — you should see a dark canvas with **“AUB — Phase 0”**.

The server logs `⚔️  AUB server listening on ws://0.0.0.0:2567`. Nothing connects
to it yet in Phase 0 — the client is standalone until Phase 1.

### Running them separately

```bash
pnpm dev:client   # Vite dev server on http://localhost:5173
pnpm dev:server   # Colyseus on ws://localhost:2567 (auto-restarts on change)
```

### Other scripts

```bash
pnpm typecheck    # tsc --noEmit across every package (strict mode)
pnpm build        # production build of the client (Vite)
```

## LAN / second machine

The server binds to `0.0.0.0` and the Vite dev server is exposed on the LAN, so
a second computer on the same Wi-Fi can play (see SPEC.md §10). Find your Mac's
IP and use it in place of `localhost`:

```bash
ipconfig getifaddr en0        # e.g. 192.168.1.42
# → open http://192.168.1.42:5173 on the other machine
```

## Repo layout

```
aubg/
├── packages/
│   ├── client/   Phaser 3 + Vite client
│   │   └── public/assets/   ← drop the Tiny Swords art here (see ASSETS.md)
│   ├── server/   Node + Colyseus authoritative server
│   └── shared/   Directive schema (Zod) + types + constants — the LLM↔game contract
├── tsconfig.base.json   one shared strict TS config, extended by every package
├── SPEC.md              full architecture & phased plan
└── ASSETS.md            how to install the Tiny Swords asset pack
```

## Art assets

The Tiny Swords pack is **not committed**. Grab it and drop it in per
[`ASSETS.md`](./ASSETS.md) before the phases that render sprites.
